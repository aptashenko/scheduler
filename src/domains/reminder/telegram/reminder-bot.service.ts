import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Context, Markup, Telegraf } from 'telegraf';
import Calendar from 'telegram-inline-calendar';
import { ReminderAiService } from '../ai/reminder-ai.service';
import { ReminderParserService, ReminderParseResult } from '../parser/reminder-parser.service';
import { ReminderStatus } from '../reminders/entities/reminder.entity';
import { RemindersService } from '../reminders/reminders.service';

type MemoirBotMode = 'polling' | 'webhook';
type CreateEventDraft = {
  parsed?: ReminderParseResult;
  step: 'text' | 'datetime' | 'confirm';
  text?: string;
};

const CREATE_EVENT_LABEL = 'Создать событие';
const VIEW_EVENTS_LABEL = 'Показать все события';

@Injectable()
export class ReminderBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderBotService.name);
  private bot?: Telegraf;
  private pollingStarted = false;
  private readonly createEventDrafts = new Map<string, CreateEventDraft>();

  constructor(
    private readonly reminderAiService: ReminderAiService,
    private readonly reminderParserService: ReminderParserService,
    private readonly remindersService: RemindersService,
  ) {}

  async onModuleInit() {
    const token = process.env.MEMOIR_BOT_TOKEN;
    if (!token) {
      this.logger.warn('MEMOIR_BOT_TOKEN is not set. Reminder bot is disabled.');
      return;
    }

    this.bot = new Telegraf(token);
    this.registerHandlers(this.bot);

    const mode = this.getMode();
    if (mode === 'webhook') {
      this.logger.log('Reminder bot initialized in webhook mode');
      return;
    }

    try {
      await this.bot.telegram.deleteWebhook();
      await this.bot.launch({ dropPendingUpdates: true });
      this.pollingStarted = true;
      this.logger.log('Reminder bot started in polling mode');
    } catch (error) {
      this.logger.error('Failed to start reminder bot', error);
      throw error;
    }
  }

  onModuleDestroy() {
    this.pollingStarted = false;
    this.bot?.stop('Nest application shutdown');
  }

  getStatus() {
    return {
      initialized: Boolean(this.bot),
      mode: this.getMode(),
      pollingStarted: this.pollingStarted,
      tokenConfigured: Boolean(process.env.MEMOIR_BOT_TOKEN),
    };
  }

  async handleWebhook(update: unknown) {
    if (!this.bot) {
      throw new Error('Reminder bot is not initialized');
    }

    await this.bot.handleUpdate(update as never);
  }

  async setWebhook(baseUrl: string) {
    if (!this.bot) {
      throw new Error('Reminder bot is not initialized');
    }

    const url = `${baseUrl.replace(/\/$/, '')}/reminder/telegram/webhook`;
    await this.bot.telegram.setWebhook(url);
    return url;
  }

  async sendMessage(telegramChatId: string, text: string) {
    if (!this.bot) {
      throw new Error('Reminder bot is not initialized');
    }

    await this.bot.telegram.sendMessage(
      telegramChatId,
      [`Напоминание`, '', text].join('\n'),
    );
  }

  private registerHandlers(bot: Telegraf) {
    const calendar = new Calendar(bot, {
      bot_api: 'telegraf',
      close_calendar: true,
      custom_start_msg: 'Выбери дату и время события',
      date_format: 'YYYY-MM-DD HH:mm',
      language: 'ru',
      start_date: 'now',
      start_week_day: 1,
      time_range: '00:00-23:59',
      time_selector_mod: true,
      time_step: '5m',
    });

    bot.catch((error) => {
      this.logger.error('Reminder bot update failed', error);
    });

    bot.start(async (ctx) => {
      await this.showMainMenu(ctx);
    });

    bot.hears(CREATE_EVENT_LABEL, async (ctx) => {
      await this.startCreateReminder(ctx);
    });

    bot.command('create', async (ctx) => {
      await this.startCreateReminder(ctx);
    });

    bot.command('list', async (ctx) => {
      await this.replyEventsList(ctx);
    });

    bot.command('calendar', async (ctx) => {
      calendar.startNavCalendar(ctx.message);
    });

    bot.hears(
      [VIEW_EVENTS_LABEL, 'Просмотреть все события', 'Просомтреть все события'],
      async (ctx) => {
        await this.replyEventsList(ctx);
      },
    );

    bot.on('callback_query', async (ctx) => {
      const query = ctx.callbackQuery as {
        data?: string;
        message?: { chat: { id: number }; message_id: number };
      };

      if (!query.message) {
        return;
      }

      if (query.data?.startsWith('delete_reminder:')) {
        await this.handleDeleteReminder(ctx, query.data, query.message.chat.id);
        return;
      }
      if (query.data === 'confirm_reminder') {
        await this.handleConfirmReminder(ctx, query.message.chat.id);
        return;
      }
      if (query.data === 'change_reminder_date') {
        await this.handleChangeReminderDate(ctx, calendar, query.message.chat.id);
        return;
      }

      const calendarMessageId = calendar.chats.get(query.message.chat.id);
      if (query.message.message_id !== calendarMessageId) {
        return;
      }

      const selectedDate = calendar.clickButtonCalendar(query);
      await ctx.answerCbQuery();

      if (selectedDate !== -1) {
        const draftKey = this.getDraftKey(ctx.from.id, query.message.chat.id);
        const draft = this.createEventDrafts.get(draftKey);

        if (!draft?.text) {
          await ctx.reply(`Выбраны дата и время: ${selectedDate}`);
          return;
        }

        this.createEventDrafts.set(draftKey, {
          parsed: {
            remindAt: this.toIsoDateTime(selectedDate),
            source: 'strict',
            text: draft.text,
          },
          step: 'confirm',
          text: draft.text,
        });
        await this.replyReminderConfirmation(ctx, {
          remindAt: this.toIsoDateTime(selectedDate),
          source: 'strict',
          text: draft.text,
        });
      }
    });

    bot.on('voice', async (ctx) => {
      if (!ctx.from || !ctx.chat) {
        return;
      }

      if (!this.reminderAiService.isConfigured()) {
        await ctx.reply('Голосовое создание требует OPENAI_API_KEY в .env.');
        return;
      }

      try {
        const fileUrl = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
        const transcript = await this.reminderAiService.transcribeVoiceFromUrl(fileUrl);
        await this.createReminderFromNaturalText(ctx, transcript, calendar);
      } catch (error) {
        this.logger.error('Failed to create reminder from voice', error);
        await ctx.reply('Не удалось распознать голосовое сообщение. Попробуйте текстом.');
      }
    });

    bot.on('text', async (ctx) => {
      const text = ctx.message.text;
      const telegramId = String(ctx.from.id);
      const draftKey = this.getDraftKey(ctx.from.id, ctx.chat.id);
      const draft = this.createEventDrafts.get(draftKey);

      if (draft?.step === 'text') {
        await this.createReminderFromNaturalText(ctx, text, calendar);
        return;
      }

      this.logger.log(`Received reminder message from ${telegramId}`);
      await ctx.reply(`Ты написал: ${text}`);
    });
  }

  private getMode(): MemoirBotMode {
    return process.env.MEMOIR_BOT_MODE === 'webhook' ? 'webhook' : 'polling';
  }

  private async showMainMenu(ctx: Context) {
    await ctx.reply(
      ['Главное меню', '', 'Выберите действие.'].join('\n'),
      Markup.keyboard([[CREATE_EVENT_LABEL], [VIEW_EVENTS_LABEL]]).resize(),
    );
  }

  private async startCreateReminder(ctx: Context) {
    if (!ctx.from || !ctx.chat) {
      return;
    }

    this.createEventDrafts.set(this.getDraftKey(ctx.from.id, ctx.chat.id), {
      step: 'text',
    });
    await ctx.reply(
      [
        'Создание события',
        '',
        'Напишите или отправьте голосом, о чем и когда нужно напомнить.',
        'Например: Позвонить врачу завтра в 14:00',
      ].join('\n'),
    );
  }

  private async createReminderFromNaturalText(
    ctx: Context & {
      chat: { id: number };
      from: { id: number };
      message?: { chat: { id: number } };
    },
    input: string,
    calendar: Calendar,
  ) {
    const draftKey = this.getDraftKey(ctx.from.id, ctx.chat.id);

    if (!this.reminderAiService.isConfigured()) {
      this.createEventDrafts.set(draftKey, {
        step: 'datetime',
        text: input,
      });
      await ctx.reply('Не удалось разобрать дату автоматически. Выберите дату и время.');
      calendar.startNavCalendar(ctx.message);
      return;
    }

    const parsed = await this.reminderParserService.parse(input);
    if (!parsed.remindAt) {
      this.createEventDrafts.set(draftKey, {
        step: 'datetime',
        text: parsed.text || input,
      });
      await ctx.reply('Не удалось понять дату и время. Выберите их в календаре.');
      calendar.startNavCalendar(ctx.message);
      return;
    }

    this.createEventDrafts.set(draftKey, {
      parsed,
      step: 'confirm',
      text: parsed.text || input,
    });
    await this.replyReminderConfirmation(ctx, parsed);
  }

  private async replyEventsList(ctx: Context) {
    if (!ctx.chat) {
      return;
    }

    const chatId = String(ctx.chat.id);
    const reminders = (await this.remindersService.findAll()).filter(
      (reminder) =>
        reminder.telegramChatId === chatId && reminder.status === ReminderStatus.Pending,
    );

    if (reminders.length === 0) {
      await ctx.reply(
        [
          'Событий пока нет.',
          '',
          `Нажмите "${CREATE_EVENT_LABEL}", чтобы добавить первое событие.`,
        ].join('\n'),
      );
      return;
    }

    await ctx.reply('<b>Ваши события</b>', { parse_mode: 'HTML' });

    for (const reminder of reminders) {
      await ctx.reply(this.formatReminderCard(reminder), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          Markup.button.callback('🗑️ Удалить', `delete_reminder:${reminder.id}`),
        ]),
      });
    }
  }

  private async replyReminderConfirmation(
    ctx: Context,
    parsed: ReminderParseResult,
  ) {
    if (!parsed.remindAt) {
      return;
    }

    await ctx.reply(
      [
        'Подтвердите напоминание',
        '',
        `Текст: ${parsed.text}`,
        `Когда: ${this.formatDateTime(new Date(parsed.remindAt))}`,
      ].join('\n'),
      Markup.inlineKeyboard([
        [
          Markup.button.callback('Подтвердить', 'confirm_reminder'),
          Markup.button.callback('Изменить дату', 'change_reminder_date'),
        ],
      ]),
    );
  }

  private async handleConfirmReminder(ctx: Context, chatId: number) {
    if (!ctx.from) {
      return;
    }

    const draftKey = this.getDraftKey(ctx.from.id, chatId);
    const draft = this.createEventDrafts.get(draftKey);
    if (!draft?.parsed?.remindAt) {
      await ctx.answerCbQuery('Напоминание не найдено');
      return;
    }

    try {
      await this.remindersService.create({
        userId: ctx.from.id,
        telegramChatId: String(chatId),
        text: draft.parsed.text,
        remindAt: draft.parsed.remindAt,
      });

      this.createEventDrafts.delete(draftKey);
      await ctx.answerCbQuery('Создано');
      await ctx.reply('Напоминание успешно создано!');
    } catch (error) {
      this.logger.error('Failed to create reminder from confirmation', error);
      await ctx.answerCbQuery('Ошибка');
      await ctx.reply(
        [
          'Не удалось создать событие.',
          '',
          'Проверьте, что PostgreSQL и Redis запущены, затем попробуйте еще раз.',
        ].join('\n'),
      );
    }
  }

  private async handleChangeReminderDate(
    ctx: Context,
    calendar: Calendar,
    chatId: number,
  ) {
    if (!ctx.from) {
      return;
    }

    const draftKey = this.getDraftKey(ctx.from.id, chatId);
    const draft = this.createEventDrafts.get(draftKey);
    if (!draft?.text && !draft?.parsed?.text) {
      await ctx.answerCbQuery('Напоминание не найдено');
      return;
    }

    this.createEventDrafts.set(draftKey, {
      step: 'datetime',
      text: draft.text ?? draft.parsed?.text,
    });
    await ctx.answerCbQuery();
    await ctx.reply('Выберите дату и время в календаре.');
    calendar.startNavCalendar({ chat: { id: chatId } });
  }

  private formatReminderStatus(status: string) {
    const labels: Record<string, string> = {
      cancelled: '⚪ отменено',
      failed: '🔴 ошибка',
      pending: '🟡 ожидает',
      sent: '🔵 отправлено',
    };

    return labels[status] ?? status;
  }

  private formatDateTime(date: Date) {
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  private formatReminderCard(reminder: {
    id: number;
    remindAt: Date;
    status: string;
    text: string;
  }) {
    return [
      `<b>#${reminder.id}</b>`,
      `Текст: ${this.escapeHtml(reminder.text)}`,
      `Когда: ${this.formatDateTime(reminder.remindAt)}`,
      `Статус: ${this.formatReminderStatus(reminder.status)}`,
    ].join('\n');
  }

  private async handleDeleteReminder(
    ctx: Context,
    callbackData: string,
    chatId: number,
  ) {
    const reminderId = Number(callbackData.replace('delete_reminder:', ''));
    if (!Number.isInteger(reminderId)) {
      await ctx.answerCbQuery('Некорректное событие');
      return;
    }

    const reminder = await this.remindersService.findOne(reminderId);
    if (reminder.telegramChatId !== String(chatId)) {
      await ctx.answerCbQuery('Это событие недоступно');
      return;
    }

    await this.remindersService.remove(reminderId);
    await ctx.answerCbQuery('Событие удалено');

    if ('editMessageText' in ctx) {
      await ctx.editMessageText(
        [
          `<b>#${reminder.id}</b>`,
          `Текст: ${this.escapeHtml(reminder.text)}`,
          '',
          'Событие удалено.',
        ].join('\n'),
        { parse_mode: 'HTML' },
      );
    }
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private getDraftKey(userId: number, chatId: number) {
    return `${chatId}:${userId}`;
  }

  private toIsoDateTime(calendarDateTime: string) {
    return new Date(calendarDateTime.replace(' ', 'T')).toISOString();
  }
}
