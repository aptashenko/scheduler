import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Context, Markup, Telegraf } from 'telegraf';
import Calendar from 'telegram-inline-calendar';
import { ReminderAiService } from '../ai/reminder-ai.service';
import {
  ReminderParserService,
  ReminderParseResult,
} from '../parser/reminder-parser.service';
import {
  dateTimeInDefaultTimeZoneToDate,
  getDefaultTimeZone,
} from '../parser/strict-reminder-parser.service';
import { ReminderStatus } from '../reminders/entities/reminder.entity';
import { RemindersService } from '../reminders/reminders.service';
import { UsersService } from '../reminders/users.service';

type MemoirBotMode = 'polling' | 'webhook';
type ReminderWizardState =
  | { step: 'awaiting_text' }
  | { step: 'awaiting_datetime'; text: string }
  | { step: 'awaiting_confirmation'; parsed: ReminderParseResult; text: string }
  | { step: 'awaiting_recipients'; parsed: ReminderParseResult; text: string };

const CREATE_EVENT_LABEL = 'Створити нагадування';
const VIEW_EVENTS_LABEL = 'Показати всі нагадування';
const NEXT_LABEL = 'Пропустити';

@Injectable()
export class ReminderBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderBotService.name);
  private bot?: Telegraf;
  private pollingStarted = false;
  private readonly reminderWizards = new Map<string, ReminderWizardState>();

  constructor(
    private readonly reminderAiService: ReminderAiService,
    private readonly reminderParserService: ReminderParserService,
    private readonly remindersService: RemindersService,
    private readonly usersService: UsersService,
  ) {}

  async onModuleInit() {
    const token = process.env.MEMOIR_BOT_TOKEN;
    if (!token) {
      this.logger.warn(
        'MEMOIR_BOT_TOKEN is not set. Reminder bot is disabled.',
      );
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

  async sendHtmlMessage(telegramChatId: string, text: string) {
    if (!this.bot) {
      throw new Error('Reminder bot is not initialized');
    }

    await this.bot.telegram.sendMessage(telegramChatId, text, {
      parse_mode: 'HTML',
    });
  }

  private registerHandlers(bot: Telegraf) {
    const calendar = new Calendar(bot, {
      bot_api: 'telegraf',
      close_calendar: true,
      custom_start_msg: 'Виберіть дату і час',
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
      await this.usersService.create({
        telegramId: String(ctx.from.id),
        telegramName: ctx.from.username ? `@${ctx.from.username}` : null,
      });
      await this.showMainMenu(ctx);
    });

    bot.hears(CREATE_EVENT_LABEL, async (ctx) => {
      await this.startCreateReminder(ctx);
    });

    bot.command('create', async (ctx) => {
      await this.startCreateReminder(ctx);
    });

    bot.command('list', async (ctx) => {
      await this.replyReminderDateButtons(ctx);
    });

    bot.command('calendar', async (ctx) => {
      calendar.startNavCalendar(ctx.message);
    });

    bot.hears([VIEW_EVENTS_LABEL], async (ctx) => {
      await this.replyReminderDateButtons(ctx);
    });

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
      if (query.data?.startsWith('view_reminders_date:')) {
        await this.handleViewRemindersDate(ctx, query.data);
        return;
      }
      if (query.data === 'confirm_reminder') {
        await this.handleConfirmReminder(ctx, query.message.chat.id);
        return;
      }
      if (query.data === 'change_reminder_date') {
        await this.handleChangeReminderDate(
          ctx,
          calendar,
          query.message.chat.id,
        );
        return;
      }

      const calendarMessageId = calendar.chats.get(query.message.chat.id);
      if (query.message.message_id !== calendarMessageId) {
        return;
      }

      const selectedDate = calendar.clickButtonCalendar(query);
      await ctx.answerCbQuery();

      if (selectedDate !== -1) {
        if (!ctx.from) {
          return;
        }

        const state = this.getWizardState(ctx.from.id, query.message.chat.id);

        if (state?.step !== 'awaiting_datetime') {
          await ctx.reply(`Выбраны дата и время: ${selectedDate}`);
          return;
        }

        const parsed = {
          parsed: {
            remindAt: this.toIsoDateTime(selectedDate),
            source: 'strict',
            text: state.text,
          },
          step: 'awaiting_confirmation',
          text: state.text,
        } satisfies ReminderWizardState;

        this.setWizardState(ctx.from.id, query.message.chat.id, parsed);
        await this.replyReminderConfirmation(ctx, {
          remindAt: parsed.parsed.remindAt,
          source: 'strict',
          text: state.text,
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
        const fileUrl = await ctx.telegram.getFileLink(
          ctx.message.voice.file_id,
        );
        const transcript =
          await this.reminderAiService.transcribeVoiceFromUrl(fileUrl);
        await this.createReminderFromNaturalText(ctx, transcript, calendar);
      } catch (error) {
        this.logger.error('Failed to create reminder from voice', error);
        await ctx.reply(
          'Не удалось распознать голосовое сообщение. Попробуйте текстом.',
        );
      }
    });

    bot.on('text', async (ctx) => {
      const text = ctx.message.text;
      const telegramId = String(ctx.from.id);
      const state = this.getWizardState(ctx.from.id, ctx.chat.id);

      if (state?.step === 'awaiting_text') {
        await this.createReminderFromNaturalText(ctx, text, calendar);
        return;
      }
      if (state?.step === 'awaiting_datetime') {
        await ctx.reply('Выберите дату и время в календаре.');
        calendar.startNavCalendar(ctx.message);
        return;
      }
      if (state?.step === 'awaiting_recipients') {
        await this.createReminderWithRecipients(ctx, text);
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
    await ctx.reply('Головне меню',
      Markup.keyboard([[CREATE_EVENT_LABEL], [VIEW_EVENTS_LABEL]]).resize(),
    );
  }

  private async startCreateReminder(ctx: Context) {
    if (!ctx.from || !ctx.chat) {
      return;
    }

    this.setWizardState(ctx.from.id, ctx.chat.id, { step: 'awaiting_text' });
    await ctx.reply(
      [
        'Створення нагадування',
        '',
        'Напишіть або відправте голосом, про що і коли треба нагадати.',
        'Наприклад: Подзвонити лікарю завтра о 14:00',
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
    if (!this.reminderAiService.isConfigured()) {
      this.setWizardState(ctx.from.id, ctx.chat.id, {
        step: 'awaiting_datetime',
        text: input,
      });
      await ctx.reply(
        'Я не зміг розпізнати дату. Виберіть дату і час будь-ласка вручну.',
      );
      calendar.startNavCalendar(ctx.message);
      return;
    }

    const parsed = await this.reminderParserService.parse(input);
    if (!parsed.remindAt) {
      this.setWizardState(ctx.from.id, ctx.chat.id, {
        step: 'awaiting_datetime',
        text: parsed.text || input,
      });
      await ctx.reply(
        'Я не зміг розпізнати дату. Виберіть дату і час будь-ласка вручну.',
      );
      calendar.startNavCalendar(ctx.message);
      return;
    }

    this.setWizardState(ctx.from.id, ctx.chat.id, {
      parsed,
      step: 'awaiting_confirmation',
      text: parsed.text || input,
    });
    await this.replyReminderConfirmation(ctx, parsed);
  }

  private async replyReminderDateButtons(ctx: Context) {
    if (!ctx.chat) {
      return;
    }

    const chatId = String(ctx.chat.id);
    const timeZone = await this.getChatTimeZone(chatId);
    const dates = this.getReminderDateOptions(
      (await this.remindersService.findAll()).filter(
        (reminder) =>
          reminder.telegramChatIds.includes(chatId) &&
          reminder.status === ReminderStatus.Pending,
      ),
      timeZone,
    );

    if (dates.length === 0) {
      await ctx.reply(
        [
          'Нагадувань ще немає.',
          '',
          `Натисність "${CREATE_EVENT_LABEL}", щоб додати перше.`,
        ].join('\n'),
      );
      return;
    }

    await ctx.reply(
      'Виберіть дату, за яку показати нагадування.',
      Markup.inlineKeyboard(
        dates.map((date) => [
          Markup.button.callback(
            this.formatDateOnly(date.date, timeZone),
            `view_reminders_date:${date.key}`,
          ),
        ]),
      ),
    );
  }

  private async handleViewRemindersDate(ctx: Context, callbackData: string) {
    const dateKey = callbackData.replace('view_reminders_date:', '');
    await ctx.answerCbQuery();
    await this.replyEventsListByDate(ctx, dateKey);
  }

  private async replyEventsListByDate(ctx: Context, selectedDate: string) {
    if (!ctx.chat) {
      return;
    }

    const chatId = String(ctx.chat.id);
    const timeZone = await this.getChatTimeZone(chatId);
    const targetDate = this.dateKeyToDefaultTimeZoneDate(
      selectedDate,
      timeZone,
    );
    const reminders = (await this.remindersService.findAll()).filter(
      (reminder) =>
        reminder.telegramChatIds.includes(chatId) &&
        reminder.status === ReminderStatus.Pending &&
        this.isSameDefaultTimeZoneDate(reminder.remindAt, targetDate, timeZone),
    );

    if (reminders.length === 0) {
      await ctx.reply(
        [
          'На вибрану дату нагадувань немає.',
          '',
          `Дата: ${this.formatDateOnly(targetDate, timeZone)}`,
        ].join('\n'),
      );
      return;
    }

    await ctx.reply(
      `<b>Напоминания на ${this.formatDateOnly(targetDate, timeZone)}</b>`,
      {
        parse_mode: 'HTML',
      },
    );

    for (const reminder of reminders) {
      await ctx.reply(await this.formatReminderCard(reminder, timeZone), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          Markup.button.callback(
            '🗑️ Видалити',
            `delete_reminder:${reminder.id}`,
          ),
        ]),
      });
    }
  }

  private async addUsers(ctx: Context) {
    await ctx.reply(
      [
        'З ким поділитись нагадуванням?',
        '',
        'Напишіть Telegram користувачів через кому.',
        'Наприклад: @userА, @userВ',
      ].join('\n'),
      Markup.keyboard([[NEXT_LABEL]]).resize(),
    );
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
        'Підтвердіть нагадування',
        '',
        `Текст: ${parsed.text}`,
        `Коли: ${this.formatDateTime(new Date(parsed.remindAt))}`,
      ].join('\n'),
      Markup.inlineKeyboard([
        [
          Markup.button.callback('Підтвердити', 'confirm_reminder'),
          Markup.button.callback('Змінити дату', 'change_reminder_date'),
        ],
      ]),
    );
  }

  private async handleConfirmReminder(ctx: Context, chatId: number) {
    if (!ctx.from) {
      return;
    }

    const state = this.getWizardState(ctx.from.id, chatId);
    if (state?.step !== 'awaiting_confirmation' || !state.parsed.remindAt) {
      await ctx.answerCbQuery('Нагадування не знайдено');
      return;
    }

    this.setWizardState(ctx.from.id, chatId, {
      parsed: state.parsed,
      step: 'awaiting_recipients',
      text: state.text,
    });

    await ctx.answerCbQuery();
    await this.addUsers(ctx);
  }

  private async createReminderWithRecipients(
    ctx: Context & {
      chat: { id: number };
      from: { id: number };
    },
    input: string,
  ) {
    const state = this.getWizardState(ctx.from.id, ctx.chat.id);
    if (state?.step !== 'awaiting_recipients' || !state.parsed.remindAt) {
      await ctx.reply('Нагадування не знайдено');
      return;
    }
    const recipients = await this.resolveRecipientChatIds(
      input,
      String(ctx.chat.id),
    );
    if (!recipients.ok) {
      await ctx.reply(
        `Користувач ${recipients.missingUsername} у нас не зареєстрований`,
      );
      return;
    }

    try {
      const reminder = await this.remindersService.create({
        userId: String(ctx.from.id),
        telegramChatIds: recipients.telegramChatIds,
        text: state.parsed.text,
        remindAt: state.parsed.remindAt,
      });
      await this.notifyAddedRecipients(
        reminder,
        recipients.telegramChatIds,
        String(ctx.chat.id),
      );

      this.clearWizardState(ctx.from.id, ctx.chat.id);
      await ctx.reply(
        'Нагадування успішно створено!',
        Markup.keyboard([[CREATE_EVENT_LABEL], [VIEW_EVENTS_LABEL]]).resize(),
      );
    } catch (error) {
      this.logger.error('Failed to create reminder with recipients', error);
      await ctx.reply('Не вдалось створити нагадування');
    }
  }

  private async resolveRecipientChatIds(input: string, currentChatId: string) {
    const recipientNames = this.parseRecipientNames(input);
    if (recipientNames.length === 0 || input.trim() === NEXT_LABEL) {
      return {
        ok: true as const,
        telegramChatIds: [currentChatId],
      };
    }

    const recipientIds: string[] = [];
    for (const recipientName of recipientNames) {
      try {
        const user = await this.usersService.findUserByUsername(recipientName);
        recipientIds.push(user.telegramId);
      } catch (error) {
        return {
          missingUsername: recipientName,
          ok: false as const,
        };
      }
    }

    return {
      ok: true as const,
      telegramChatIds: Array.from(
        new Set([currentChatId, ...recipientIds].filter(Boolean)),
      ),
    };
  }

  private async notifyAddedRecipients(
    reminder: {
      id: number;
      remindAt: Date;
      status: string;
      text: string;
      telegramChatIds: string[];
    },
    telegramChatIds: string[],
    currentChatId: string,
  ) {
    for (const telegramChatId of telegramChatIds) {
      if (telegramChatId === currentChatId) {
        continue;
      }

      try {
        await this.sendReminderInvite(telegramChatId, reminder);
      } catch (error) {
        this.logger.error(
          `Failed to notify reminder recipient ${telegramChatId}`,
          error,
        );
      }
    }
  }

  private async sendReminderInvite(
    telegramChatId: string,
    reminder: {
      id: number;
      remindAt: Date;
      status: string;
      text: string;
      telegramChatIds: string[];
    },
  ) {
    if (!this.bot) {
      throw new Error('Reminder bot is not initialized');
    }

    const timeZone = await this.getChatTimeZone(telegramChatId);
    await this.bot.telegram.sendMessage(
      telegramChatId,
      [
        'Вас додали до нагадування',
        '',
        await this.formatReminderCard(reminder, timeZone),
      ].join('\n'),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          Markup.button.callback(
            '🗑️ Видалити',
            `delete_reminder:${reminder.id}`,
          ),
        ]),
      },
    );
  }

  private parseRecipientNames(input: string) {
    return input
      .split(',')
      .map((value) => this.normalizeTelegramUsername(value))
      .filter(Boolean);
  }

  private normalizeTelegramUsername(value: string) {
    const username = value.trim();
    if (!username) {
      return '';
    }
    return username.startsWith('@') ? username : `@${username}`;
  }

  private async handleChangeReminderDate(
    ctx: Context,
    calendar: Calendar,
    chatId: number,
  ) {
    if (!ctx.from) {
      return;
    }

    const state = this.getWizardState(ctx.from.id, chatId);
    if (
      state?.step !== 'awaiting_confirmation' &&
      state?.step !== 'awaiting_recipients'
    ) {
      await ctx.answerCbQuery('Нагадування не знайдено');
      return;
    }

    this.setWizardState(ctx.from.id, chatId, {
      step: 'awaiting_datetime',
      text: state.text,
    });
    await ctx.answerCbQuery();
    await ctx.reply('Виберіть дату і час в календарі.');
    calendar.startNavCalendar({ chat: { id: chatId } });
  }

  private formatReminderStatus(status: string) {
    const labels: Record<string, string> = {
      cancelled: '⚪ відмінено',
      failed: '🔴 помилка',
      pending: '🟡 очікує...',
      sent: '🔵 відправлено',
    };

    return labels[status] ?? status;
  }

  private formatDateTime(date: Date, timeZone = getDefaultTimeZone()) {
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    });
  }

  private formatDateOnly(date: Date, timeZone = getDefaultTimeZone()) {
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    });
  }

  private getReminderDateOptions(
    reminders: Array<{
      remindAt: Date;
    }>,
    timeZone = getDefaultTimeZone(),
  ) {
    const dates = new Map<string, Date>();

    for (const reminder of reminders) {
      const key = this.getDefaultTimeZoneDateKey(reminder.remindAt, timeZone);
      if (!dates.has(key)) {
        dates.set(key, this.dateKeyToDefaultTimeZoneDate(key, timeZone));
      }
    }

    return Array.from(dates.entries())
      .map(([key, date]) => ({ date, key }))
      .sort((left, right) => left.date.getTime() - right.date.getTime());
  }

  private getDefaultTimeZoneDateKey(
    date: Date,
    timeZone = getDefaultTimeZone(),
  ) {
    const parts = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );

    return `${values.year}-${values.month}-${values.day}`;
  }

  private dateKeyToDefaultTimeZoneDate(
    dateKey: string,
    timeZone = getDefaultTimeZone(),
  ) {
    const [year, month, day] = dateKey.split('-').map(Number);
    return dateTimeInDefaultTimeZoneToDate(year, month, day, 0, 0, {
      timezone: timeZone,
    });
  }

  private isSameDefaultTimeZoneDate(
    left: Date,
    right: Date,
    timeZone = getDefaultTimeZone(),
  ) {
    return (
      this.getDefaultTimeZoneDateKey(left, timeZone) ===
      this.getDefaultTimeZoneDateKey(right, timeZone)
    );
  }

  private async formatReminderCard(
    reminder: {
      id: number;
      remindAt: Date;
      status: string;
      text: string;
      telegramChatIds: string[];
    },
    timeZone = getDefaultTimeZone(),
  ) {
    const users = await this.parseTelegramUsers(reminder.telegramChatIds);
    const formattedUsers =
      users.length > 0
        ? users.map((user) => this.escapeHtml(user)).join(', ')
        : 'тільки вы';

    const message = [
      `<b>Нагадування #${reminder.id}</b>`,
      '',
      `📝 <b>Текст</b>`,
      this.escapeHtml(reminder.text),
      '',
      `🕒 <b>Коли</b>`,
      this.formatDateTime(reminder.remindAt, timeZone),
      '',
      `👥 <b>Учасники</b>`,
      formattedUsers,
      '',
      `📌 <b>Статус</b>`,
      this.formatReminderStatus(reminder.status),
    ];
    return message.join('\n');
  }

  private async handleDeleteReminder(
    ctx: Context,
    callbackData: string,
    chatId: number,
  ) {
    const reminderId = Number(callbackData.replace('delete_reminder:', ''));
    if (!Number.isInteger(reminderId)) {
      await ctx.answerCbQuery('Некорректне нагадування');
      return;
    }

    const reminder = await this.remindersService.findOne(reminderId);
    if (!reminder.telegramChatIds.includes(String(chatId))) {
      await ctx.answerCbQuery('Це нагадування недоступне');
      return;
    }

    const updatedReminder = await this.remindersService.detachChatId(
      reminderId,
      String(chatId),
    );
    await ctx.answerCbQuery('Нагадування видалене з вашего списку');

    if ('editMessageText' in ctx) {
      await ctx.editMessageText(
        [
          `<b>#${reminder.id}</b>`,
          `Текст: ${this.escapeHtml(reminder.text)}`,
          '',
          updatedReminder.status === ReminderStatus.Cancelled
            ? 'Нагадування відмінено.'
            : 'Нагадування видалено з вашего списку.',
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

  private async parseTelegramUsers(input: string[]) {
    const users: string[] = [];
    for (const id of input) {
      try {
        const user = await this.usersService.findUserById(id);
        users.push(user.telegramName ?? id);
      } catch (error) {
        users.push(id);
      }
    }
    return users;
  }

  private async getChatTimeZone(telegramChatId: string) {
    try {
      const user = await this.usersService.findUserById(telegramChatId);
      return getDefaultTimeZone(user);
    } catch (error) {
      return getDefaultTimeZone();
    }
  }

  private getWizardState(userId: number, chatId: number) {
    return this.reminderWizards.get(this.getWizardKey(userId, chatId));
  }

  private setWizardState(
    userId: number,
    chatId: number,
    state: ReminderWizardState,
  ) {
    this.reminderWizards.set(this.getWizardKey(userId, chatId), state);
  }

  private clearWizardState(userId: number, chatId: number) {
    this.reminderWizards.delete(this.getWizardKey(userId, chatId));
  }

  private getWizardKey(userId: number, chatId: number) {
    return `${chatId}:${userId}`;
  }

  private toIsoDateTime(calendarDateTime: string) {
    const match = calendarDateTime.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/,
    );
    if (!match) {
      return new Date(calendarDateTime.replace(' ', 'T')).toISOString();
    }

    return dateTimeInDefaultTimeZoneToDate(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
    ).toISOString();
  }
}
