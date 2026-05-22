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
import type { Users } from '../reminders/entities/users.entity';
import { RemindersService } from '../reminders/reminders.service';
import { UsersService } from '../reminders/users.service';

type MemoirBotMode = 'polling' | 'webhook';
type ReminderChatContext = Context & {
  chat: { id: number };
  from: { id: number };
};
type ReminderWizardState =
  | { step: 'awaiting_text' }
  | { step: 'awaiting_group_member_username' }
  | { step: 'awaiting_datetime'; text: string }
  | {
      step: 'awaiting_remind_before';
      parsed: ReminderParseResult;
      text: string;
    }
  | {
      step: 'awaiting_confirmation';
      parsed: ReminderParseResult;
      remindBeforeMinutes: number;
      text: string;
    }
  | {
      step: 'awaiting_recipients';
      parsed: ReminderParseResult;
      remindBeforeMinutes: number;
      selectedRecipientIds: string[];
      text: string;
    };

const BACK_LABEL = '🔙 Back';
const CREATE_EVENT_LABEL = '📝 Create new';
const TIME_ZONE_LABEL = '🌍 Select timezone';
const CHANGE_TIME_ZONE_LABEL = 'Change';
const VIEW_EVENTS_LABEL = '📅 Show all';
const MY_GROUP_LABEL = '👥 My group';
const ADD_GROUP_MEMBER_LABEL = 'Add user';
const NEXT_LABEL = 'Only me';
const RECIPIENTS_DONE_LABEL = 'Done';
const timeZones = [
  'Europe/Paris',
  'Europe/Kyiv',
  'Europe/Warsaw',
  'Europe/London',
  'America/New_York',
];
const REMIND_BEFORE_OPTIONS = [5, 10, 15, 30, 60];

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
      [`Reminder`, '', text].join('\n'),
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
      custom_start_msg: 'Choose date and time',
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
        firstName: ctx.from.first_name ?? null,
        lastName: ctx.from.last_name ?? null,
      });
      await this.showMainMenu(ctx);
    });

    bot.hears(CREATE_EVENT_LABEL, async (ctx) => {
      await this.startCreateReminder(ctx);
    });

    bot.hears(TIME_ZONE_LABEL, async (ctx) => {
      await this.selectTimeZone(ctx);
    });

    bot.hears(CHANGE_TIME_ZONE_LABEL, async (ctx) => {
      await this.selectTimeZone(ctx);
    });

    bot.hears(timeZones, async (ctx) => {
      await this.usersService.updateTimezone(
        String(ctx.from.id),
        ctx.message.text,
      );

      await ctx.reply(`✅ Timezone saved: ${ctx.message.text}`);

      await this.showMainMenu(ctx);
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

    bot.hears(MY_GROUP_LABEL, async (ctx) => {
      await this.replyGroupMembers(ctx);
    });

    bot.hears(BACK_LABEL, async (ctx) => {
      await this.showMainMenu(ctx);
    });

    bot.hears(ADD_GROUP_MEMBER_LABEL, async (ctx) => {
      await this.startAddGroupMember(ctx);
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
      if (query.data?.startsWith('remind_before:')) {
        await this.handleRemindBefore(ctx, query.data, query.message.chat.id);
        return;
      }
      if (query.data?.startsWith('recipient_toggle:')) {
        await this.handleRecipientToggle(
          ctx,
          query.data,
          query.message.chat.id,
        );
        return;
      }
      if (query.data === 'recipients_done') {
        await this.handleRecipientSelectionDone(ctx, query.message.chat.id);
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
          await ctx.reply(`Selected datetime: ${selectedDate}`);
          return;
        }

        const timeZone = await this.getChatTimeZone(String(ctx.from.id));
        const parsed = {
          parsed: {
            remindAt: this.toIsoDateTime(selectedDate, timeZone),
            source: 'strict',
            text: state.text,
          },
          step: 'awaiting_remind_before',
          text: state.text,
        } satisfies ReminderWizardState;

        this.setWizardState(ctx.from.id, query.message.chat.id, parsed);
        await this.replyRemindBeforeOptions(ctx);
      }
    });

    bot.on('voice', async (ctx) => {
      if (!ctx.from || !ctx.chat) {
        return;
      }

      if (!this.reminderAiService.isConfigured()) {
        await ctx.reply('AI is not configured yet');
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
        await ctx.reply('Voice massage is failed. Try again');
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
      if (state?.step === 'awaiting_group_member_username') {
        await this.addGroupMember(ctx, text);
        return;
      }
      if (state?.step === 'awaiting_datetime') {
        await ctx.reply('Choose date and time in calendar.');
        calendar.startNavCalendar(ctx.message);
        return;
      }
      if (state?.step === 'awaiting_remind_before') {
        await this.replyRemindBeforeOptions(ctx);
        return;
      }
      if (state?.step === 'awaiting_recipients') {
        await this.createReminderWithRecipients(ctx, text);
        return;
      }

      this.logger.log(`Received reminder message from ${telegramId}`);
      await ctx.reply(`Unknown command`);
    });
  }

  private getMode(): MemoirBotMode {
    return process.env.MEMOIR_BOT_MODE === 'webhook' ? 'webhook' : 'polling';
  }

  private async showMainMenu(ctx: Context) {
    const timezone = await this.usersService.getTimeZone(String(ctx.from!.id));
    let timeZoneButton = [TIME_ZONE_LABEL];
    if (timezone) {
      timeZoneButton[0] = `Timezone: ${timezone}`;
      timeZoneButton.push(CHANGE_TIME_ZONE_LABEL);
    }

    await ctx.reply(
      'Main menu',
      Markup.keyboard([
        [CREATE_EVENT_LABEL, VIEW_EVENTS_LABEL],
        [MY_GROUP_LABEL],
        timeZoneButton,
      ]).resize(),
    );
  }

  private async selectTimeZone(ctx: Context) {
    await ctx.reply(
      'Select timezone',
      Markup.keyboard(timeZones.map((key) => [key])).resize(),
    );
  }

  private async startCreateReminder(ctx: Context) {
    if (!ctx.from || !ctx.chat) {
      return;
    }

    this.setWizardState(ctx.from.id, ctx.chat.id, { step: 'awaiting_text' });
    await ctx.reply(
      [
        'Create reminder',
        '',
        'Tell me what and when to remind you. You can send text or voice messages.',
        'Example: Call the doctor tomorrow at 14:00',
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
    const timeZone = await this.getChatTimeZone(String(ctx.from.id));
    const parsed = await this.reminderParserService.parse(input, {
      timezone: timeZone,
    });
    if (!parsed.remindAt) {
      this.setWizardState(ctx.from.id, ctx.chat.id, {
        step: 'awaiting_datetime',
        text: parsed.text || input,
      });
      await ctx.reply(
        'I could not recognize the date. Please select the date and time manually.',
      );
      calendar.startNavCalendar(ctx.message);
      return;
    }

    this.setWizardState(ctx.from.id, ctx.chat.id, {
      parsed,
      step: 'awaiting_remind_before',
      text: parsed.text || input,
    });
    await this.replyRemindBeforeOptions(ctx);
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
          'No reminders yet.',
          '',
          `Tap "${CREATE_EVENT_LABEL}" to add your first reminder.`,
        ].join('\n'),
      );
      return;
    }

    await ctx.reply(
      'Choose a date for which to show reminders.',
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
        this.isSameDefaultTimeZoneDate(
          reminder.eventAt ?? reminder.remindAt,
          targetDate,
          timeZone,
        ),
    );

    if (reminders.length === 0) {
      await ctx.reply(
        [
          'No reminders found for this date.',
          '',
          `Date: ${this.formatDateOnly(targetDate, timeZone)}`,
        ].join('\n'),
      );
      return;
    }

    await ctx.reply(
      `<b>Reminders for ${this.formatDateOnly(targetDate, timeZone)}</b>`,
      {
        parse_mode: 'HTML',
      },
    );

    for (const reminder of reminders) {
      await ctx.reply(await this.formatReminderCard(reminder, timeZone), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          Markup.button.callback('🗑️ Delete', `delete_reminder:${reminder.id}`),
        ]),
      });
    }
  }

  private async addUsers(ctx: Context) {
    const members = ctx.from
      ? await this.usersService.findGroupMembers(String(ctx.from.id))
      : [];

    await ctx.reply(
      [
        'Share reminder',
        '',
        'Enter Telegram usernames separated by commas.',
        'Example: @userA, @userB',
      ].join('\n'),
      Markup.keyboard([[NEXT_LABEL]]).resize(),
    );

    if (members.length === 0) {
      return;
    }

    await ctx.reply(
      'Or select users from your group.',
      this.buildRecipientSelectionKeyboard(members, []),
    );
  }

  private async replyGroupMembers(ctx: Context) {
    if (!ctx.from) {
      return;
    }

    const members = await this.usersService.findGroupMembers(
      String(ctx.from.id),
    );
    const message =
      members.length === 0
        ? ['My group', '', 'No users added yet.'].join('\n')
        : [
            'My group',
            '',
            ...members.map((member) => this.formatGroupMember(member)),
          ].join('\n');

    await ctx.reply(
      message,
      Markup.keyboard([
        [ADD_GROUP_MEMBER_LABEL, MY_GROUP_LABEL],
        [BACK_LABEL],
      ]).resize(),
    );
  }

  private async startAddGroupMember(ctx: Context) {
    if (!ctx.from || !ctx.chat) {
      return;
    }

    this.setWizardState(ctx.from.id, ctx.chat.id, {
      step: 'awaiting_group_member_username',
    });
    await ctx.reply('Enter Telegram username. Example: @aptashenko');
  }

  private async addGroupMember(ctx: ReminderChatContext, input: string) {
    try {
      await this.usersService.addGroupMember(String(ctx.from.id), input);
      this.clearWizardState(ctx.from.id, ctx.chat.id);
      await ctx.reply('User added.');
      await this.replyGroupMembers(ctx);
    } catch (error) {
      await ctx.reply('User was not found in the database.');
    }
  }

  private async handleRecipientToggle(
    ctx: Context,
    callbackData: string,
    chatId: number,
  ) {
    if (!ctx.from) {
      return;
    }

    const state = this.getWizardState(ctx.from.id, chatId);
    if (state?.step !== 'awaiting_recipients') {
      await ctx.answerCbQuery('Reminder not found');
      return;
    }

    const memberTelegramId = callbackData.replace('recipient_toggle:', '');
    const selectedRecipientIds = state.selectedRecipientIds.includes(
      memberTelegramId,
    )
      ? state.selectedRecipientIds.filter((id) => id !== memberTelegramId)
      : [...state.selectedRecipientIds, memberTelegramId];

    this.setWizardState(ctx.from.id, chatId, {
      ...state,
      selectedRecipientIds,
    });

    const members = await this.usersService.findGroupMembers(
      String(ctx.from.id),
    );
    await ctx.answerCbQuery();

    if ('editMessageReplyMarkup' in ctx) {
      await ctx.editMessageReplyMarkup(
        this.buildRecipientSelectionKeyboard(members, selectedRecipientIds)
          .reply_markup,
      );
    }
  }

  private async handleRecipientSelectionDone(ctx: Context, chatId: number) {
    if (!ctx.from || !ctx.chat) {
      return;
    }

    const state = this.getWizardState(ctx.from.id, chatId);
    if (state?.step !== 'awaiting_recipients') {
      await ctx.answerCbQuery('Reminder not found');
      return;
    }

    await ctx.answerCbQuery();
    await this.createReminderForRecipientIds(ctx as ReminderChatContext, [
      String(chatId),
      ...state.selectedRecipientIds,
    ]);
  }

  private buildRecipientSelectionKeyboard(
    members: Users[],
    selectedRecipientIds: string[],
  ) {
    return Markup.inlineKeyboard([
      ...members.map((member) => [
        Markup.button.callback(
          `${selectedRecipientIds.includes(member.telegramId) ? '✅' : '☐'} ${this.formatGroupMember(member)}`,
          `recipient_toggle:${member.telegramId}`,
        ),
      ]),
      [Markup.button.callback(RECIPIENTS_DONE_LABEL, 'recipients_done')],
    ]);
  }

  private async replyRemindBeforeOptions(ctx: Context) {
    await ctx.reply(
      'When should I remind you before the main time?',
      Markup.inlineKeyboard([
        REMIND_BEFORE_OPTIONS.slice(0, 2).map((minutes) =>
          Markup.button.callback(`${minutes} min`, `remind_before:${minutes}`),
        ),
        REMIND_BEFORE_OPTIONS.slice(2).map((minutes) =>
          Markup.button.callback(`${minutes} min`, `remind_before:${minutes}`),
        ),
      ]),
    );
  }

  private async replyReminderConfirmation(
    ctx: Context,
    parsed: ReminderParseResult,
    remindBeforeMinutes: number,
  ) {
    if (!parsed.remindAt) {
      return;
    }

    const timeZone =
      ctx.from !== undefined
        ? await this.getChatTimeZone(String(ctx.from.id))
        : getDefaultTimeZone();

    await ctx.reply(
      [
        'Confirm reminder',
        '',
        `Reminder: ${parsed.text}`,
        `Time: ${this.formatDateTime(new Date(parsed.remindAt), timeZone)}`,
        ...(parsed.recurrence
          ? [`Repeat: ${this.formatRecurrence(parsed.recurrence)}`]
          : []),
        `Also remind: ${remindBeforeMinutes} min before`,
      ].join('\n'),
      Markup.inlineKeyboard([
        [
          Markup.button.callback('Confirm', 'confirm_reminder'),
          Markup.button.callback('Change date', 'change_reminder_date'),
        ],
      ]),
    );
  }

  private async handleRemindBefore(
    ctx: Context,
    callbackData: string,
    chatId: number,
  ) {
    if (!ctx.from) {
      return;
    }

    const minutes = Number(callbackData.replace('remind_before:', ''));
    if (!REMIND_BEFORE_OPTIONS.includes(minutes)) {
      await ctx.answerCbQuery('Invalid reminder interval');
      return;
    }

    const state = this.getWizardState(ctx.from.id, chatId);
    if (state?.step !== 'awaiting_remind_before' || !state.parsed.remindAt) {
      await ctx.answerCbQuery('Reminder not found');
      return;
    }

    this.setWizardState(ctx.from.id, chatId, {
      parsed: state.parsed,
      remindBeforeMinutes: minutes,
      step: 'awaiting_confirmation',
      text: state.text,
    });

    await ctx.answerCbQuery();
    await this.replyReminderConfirmation(ctx, state.parsed, minutes);
  }

  private async handleConfirmReminder(ctx: Context, chatId: number) {
    if (!ctx.from) {
      return;
    }

    const state = this.getWizardState(ctx.from.id, chatId);
    if (state?.step !== 'awaiting_confirmation' || !state.parsed.remindAt) {
      await ctx.answerCbQuery('Reminder not found');
      return;
    }

    this.setWizardState(ctx.from.id, chatId, {
      parsed: state.parsed,
      remindBeforeMinutes: state.remindBeforeMinutes,
      selectedRecipientIds: [],
      step: 'awaiting_recipients',
      text: state.text,
    });

    await ctx.answerCbQuery();
    await this.addUsers(ctx);
  }

  private async createReminderWithRecipients(
    ctx: ReminderChatContext,
    input: string,
  ) {
    const state = this.getWizardState(ctx.from.id, ctx.chat.id);
    if (state?.step !== 'awaiting_recipients' || !state.parsed.remindAt) {
      await ctx.answerCbQuery('Reminder not found');
      return;
    }
    const recipients = await this.resolveRecipientChatIds(
      input,
      String(ctx.chat.id),
      state.selectedRecipientIds,
    );
    if (!recipients.ok) {
      await ctx.reply(
        `User ${recipients.missingUsername} has not registered yet`,
      );
      return;
    }

    await this.createReminderForRecipientIds(ctx, recipients.telegramChatIds);
  }

  private async createReminderForRecipientIds(
    ctx: ReminderChatContext,
    telegramChatIds: string[],
  ) {
    const state = this.getWizardState(ctx.from.id, ctx.chat.id);
    if (state?.step !== 'awaiting_recipients' || !state.parsed.remindAt) {
      await ctx.reply('Reminder not found');
      return;
    }

    try {
      const reminder = await this.remindersService.create({
        userId: String(ctx.from.id),
        telegramChatIds,
        text: state.parsed.text,
        remindAt: state.parsed.remindAt,
        eventAt: state.parsed.remindAt,
        recurrence: state.parsed.recurrence ?? undefined,
        remindBeforeMinutes: state.remindBeforeMinutes,
      });
      await this.notifyAddedRecipients(
        reminder,
        telegramChatIds,
        String(ctx.chat.id),
      );

      this.clearWizardState(ctx.from.id, ctx.chat.id);

      const timezone = await this.usersService.getTimeZone(
        String(ctx.from!.id),
      );
      let timeZoneButton = [TIME_ZONE_LABEL];
      if (timezone) {
        timeZoneButton[0] = `Timezone: ${timezone}`;
        timeZoneButton.push(CHANGE_TIME_ZONE_LABEL);
      }

      await ctx.reply(
        'Reminder created!',
        Markup.keyboard([
          [CREATE_EVENT_LABEL, VIEW_EVENTS_LABEL],
          [MY_GROUP_LABEL],
          timeZoneButton,
        ]).resize(),
      );
    } catch (error) {
      this.logger.error('Failed to create reminder with recipients', error);
      await ctx.reply('Could not create the reminder');
    }
  }

  private async resolveRecipientChatIds(
    input: string,
    currentChatId: string,
    selectedRecipientIds: string[] = [],
  ) {
    const recipientNames = this.parseRecipientNames(input);
    if (input.trim() === NEXT_LABEL) {
      return {
        ok: true as const,
        telegramChatIds: Array.from(
          new Set([currentChatId, ...selectedRecipientIds].filter(Boolean)),
        ),
      };
    }
    if (recipientNames.length === 0 && selectedRecipientIds.length === 0) {
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
        new Set(
          [currentChatId, ...selectedRecipientIds, ...recipientIds].filter(
            Boolean,
          ),
        ),
      ),
    };
  }

  private async notifyAddedRecipients(
    reminder: {
      id: number;
      eventAt?: Date | null;
      remindAt: Date;
      remindBeforeMinutes?: number | null;
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
      eventAt?: Date | null;
      remindAt: Date;
      remindBeforeMinutes?: number | null;
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
        'You were added to a shared reminder',
        '',
        await this.formatReminderCard(reminder, timeZone),
      ].join('\n'),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          Markup.button.callback('🗑️ Delete', `delete_reminder:${reminder.id}`),
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
      await ctx.answerCbQuery('This reminder was not found');
      return;
    }

    this.setWizardState(ctx.from.id, chatId, {
      step: 'awaiting_datetime',
      text: state.text,
    });
    await ctx.answerCbQuery();
    await ctx.reply('Choose a date and time from the calendar.');
    calendar.startNavCalendar({ chat: { id: chatId } });
  }

  private formatReminderStatus(status: string) {
    const labels: Record<string, string> = {
      cancelled: '⚪ cancelled',
      failed: '🔴 error',
      pending: '🟡 waiting...',
      sent: '🔵 sent',
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

  private formatRecurrence(
    recurrence: NonNullable<ReminderParseResult['recurrence']>,
  ) {
    if (recurrence.frequency === 'monthly') {
      return `every month on day ${recurrence.dayOfMonth}`;
    }

    const weekdays: Record<number, string> = {
      1: 'Monday',
      2: 'Tuesday',
      3: 'Wednesday',
      4: 'Thursday',
      5: 'Friday',
      6: 'Saturday',
      7: 'Sunday',
    };
    return `every ${weekdays[recurrence.weekday ?? 0] ?? 'week'}`;
  }

  private getReminderDateOptions(
    reminders: Array<{
      eventAt?: Date | null;
      remindAt: Date;
    }>,
    timeZone = getDefaultTimeZone(),
  ) {
    const dates = new Map<string, Date>();

    for (const reminder of reminders) {
      const key = this.getDefaultTimeZoneDateKey(
        reminder.eventAt ?? reminder.remindAt,
        timeZone,
      );
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
      eventAt?: Date | null;
      remindAt: Date;
      remindBeforeMinutes?: number | null;
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
        : 'only you';
    const eventAt = reminder.eventAt ?? reminder.remindAt;

    const message = [
      `<b>Reminder #${reminder.id}</b>`,
      '',
      `📝 <b>Text</b>`,
      this.escapeHtml(reminder.text),
      '',
      `🕒 <b>When</b>`,
      this.formatDateTime(eventAt, timeZone),
      '',
      `⏱️ <b>Before</b>`,
      reminder.remindBeforeMinutes === null ||
      reminder.remindBeforeMinutes === undefined
        ? 'not set'
        : `${reminder.remindBeforeMinutes} min`,
      '',
      `👥 <b>Participants</b>`,
      formattedUsers,
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
      await ctx.answerCbQuery('Invalid reminder data');
      return;
    }

    const reminder = await this.remindersService.findOne(reminderId);
    if (!reminder.telegramChatIds.includes(String(chatId))) {
      await ctx.answerCbQuery('This reminder is unavailable');
      return;
    }

    const updatedReminder = await this.remindersService.detachChatId(
      reminderId,
      String(chatId),
    );
    await ctx.answerCbQuery('Reminder removed from your list');

    if ('editMessageText' in ctx) {
      await ctx.editMessageText(
        [
          `<b>#${reminder.id}</b>`,
          `Text: ${this.escapeHtml(reminder.text)}`,
          '',
          updatedReminder.status === ReminderStatus.Cancelled
            ? 'Reminder cancelled.'
            : 'Reminder removed from your list.',
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

  private formatGroupMember(user: {
    firstName: string | null;
    lastName: string | null;
    telegramId: string;
    telegramName: string | null;
  }) {
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    return `${fullName || user.telegramId} / ${user.telegramName ?? user.telegramId}`;
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

  private toIsoDateTime(
    calendarDateTime: string,
    timeZone = getDefaultTimeZone(),
  ) {
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
      { timezone: timeZone },
    ).toISOString();
  }
}
