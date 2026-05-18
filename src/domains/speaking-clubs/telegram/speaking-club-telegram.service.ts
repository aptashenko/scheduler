import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Markup, Telegraf } from 'telegraf';
import Calendar from 'telegram-inline-calendar';
import { SearchSpeakingClubsDto } from '../dto/search-speaking-clubs.dto';
import {
  SpeakingClubLanguage,
  SpeakingClubLevel,
} from '../entities/speaking-club.enums';
import { SpeakingClubAnalyticsService } from '../speaking-club-analytics.service';
import { SpeakingClubBookingsService } from '../speaking-club-bookings.service';
import { SpeakingClubsService } from '../speaking-clubs.service';

type SpeakingClubBotMode = 'polling' | 'webhook';
type StudentSearchState = Partial<SearchSpeakingClubsDto>;
type TeacherDraftStep =
  | 'displayName'
  | 'timezone'
  | 'title'
  | 'description'
  | 'targetLanguage'
  | 'supportLanguages'
  | 'level'
  | 'durationMinutes'
  | 'capacity'
  | 'price'
  | 'currency'
  | 'sessionStartAt'
  | 'sessionTimezone';
type TeacherDraft = {
  step: TeacherDraftStep;
  teacherId?: number;
  clubId?: number;
  data: {
    displayName?: string;
    timezone?: string;
    title?: string;
    description?: string | null;
    targetLanguage?: SpeakingClubLanguage;
    supportLanguages?: SpeakingClubLanguage[];
    levels?: SpeakingClubLevel[];
    durationMinutes?: number;
    capacity?: number;
    price?: number;
    currency?: string;
    isFree?: boolean;
    sessionStartAt?: string;
    sessionTimezone?: string;
  };
};

const STUDENT_FIND_CLUB = '🔎 Find club';
const STUDENT_MY_SESSIONS = '📅 My sessions';
const STUDENT_PAYMENTS = '💳 Payments';
const STUDENT_FAVORITES = '⭐ Favorite clubs';
const STUDENT_SETTINGS = '⚙️ Settings';

const TEACHER_MY_CLUBS = '📅 My clubs';
const TEACHER_CREATE_CLUB = '➕ Create club';
const TEACHER_STUDENTS = '👥 Students';
const TEACHER_ANALYTICS = '📈 Analytics';
const TEACHER_PAYOUTS = '💳 Payouts';
const TEACHER_SETTINGS = '⚙️ Settings';
const CURRENCY_OPTIONS = ['USD', 'EUR', 'UAH'];
const TIMEZONE_OPTIONS = [
  'Europe/Paris',
  'Europe/Kyiv',
  'Europe/London',
  'America/New_York',
  'Asia/Dubai',
];
const TARGET_LANGUAGE_OPTIONS = [
  SpeakingClubLanguage.EN,
  SpeakingClubLanguage.FR,
  SpeakingClubLanguage.DE,
  SpeakingClubLanguage.ES,
  SpeakingClubLanguage.IT,
];
const SUPPORT_LANGUAGE_OPTIONS = [
  SpeakingClubLanguage.UA,
  SpeakingClubLanguage.RU,
  SpeakingClubLanguage.EN,
  SpeakingClubLanguage.FR,
];
const LEVEL_OPTIONS = [
  SpeakingClubLevel.A1,
  SpeakingClubLevel.A2,
  SpeakingClubLevel.B1,
  SpeakingClubLevel.B2,
  SpeakingClubLevel.C1,
];
const LANGUAGE_FLAGS: Record<SpeakingClubLanguage, string> = {
  [SpeakingClubLanguage.EN]: '🇬🇧',
  [SpeakingClubLanguage.FR]: '🇫🇷',
  [SpeakingClubLanguage.DE]: '🇩🇪',
  [SpeakingClubLanguage.ES]: '🇪🇸',
  [SpeakingClubLanguage.IT]: '🇮🇹',
  [SpeakingClubLanguage.UA]: '🇺🇦',
  [SpeakingClubLanguage.RU]: '🇷🇺',
  [SpeakingClubLanguage.Other]: '🌐',
};

@Injectable()
export class SpeakingClubTelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SpeakingClubTelegramService.name);
  private bot?: Telegraf;
  private pollingStarted = false;
  private readonly studentSearch = new Map<string, StudentSearchState>();
  private readonly teacherDrafts = new Map<string, TeacherDraft>();

  constructor(
    private readonly speakingClubsService: SpeakingClubsService,
    private readonly bookingsService: SpeakingClubBookingsService,
    private readonly analyticsService: SpeakingClubAnalyticsService,
  ) {}

  async onModuleInit() {
    const token = process.env.SPEAKING_CLUBS_TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.warn(
        'SPEAKING_CLUBS_TELEGRAM_BOT_TOKEN is not set. Speaking clubs bot is disabled.',
      );
      return;
    }

    this.bot = new Telegraf(token);
    this.registerHandlers(this.bot);

    if (this.getMode() === 'webhook') {
      this.logger.log('Speaking clubs bot initialized in webhook mode');
      return;
    }
    if (process.env.SPEAKING_CLUBS_TELEGRAM_POLLING !== 'true') {
      this.logger.log(
        'Speaking clubs Telegram polling is disabled. Set SPEAKING_CLUBS_TELEGRAM_POLLING=true to enable it.',
      );
      return;
    }

    await this.bot.telegram.deleteWebhook();
    await this.bot.launch({ dropPendingUpdates: true });
    this.pollingStarted = true;
    this.logger.log('Speaking clubs bot started in polling mode');
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
      tokenConfigured: Boolean(process.env.SPEAKING_CLUBS_TELEGRAM_BOT_TOKEN),
    };
  }

  async handleWebhook(update: unknown) {
    if (!this.bot) {
      throw new Error('Speaking clubs bot is not initialized');
    }

    await this.bot.handleUpdate(update as never);
  }

  async setWebhook(baseUrl: string) {
    if (!this.bot) {
      throw new Error('Speaking clubs bot is not initialized');
    }

    const url = `${baseUrl.replace(/\/$/, '')}/speaking-clubs/telegram/webhook`;
    await this.bot.telegram.setWebhook(url);
    return url;
  }

  private registerHandlers(bot: Telegraf) {
    const calendar = new Calendar(bot, {
      bot_api: 'telegraf',
      close_calendar: true,
      custom_start_msg: 'Choose session date and time',
      date_format: 'YYYY-MM-DD HH:mm',
      language: 'en',
      start_date: 'now',
      start_week_day: 1,
      time_range: '00:00-23:59',
      time_selector_mod: true,
      time_step: '15m',
    });

    bot.catch((error) => {
      this.logger.error('Speaking clubs bot update failed', error);
    });

    bot.start(async (ctx) => {
      await this.showStudentMenu(ctx);
    });
    bot.command('student', async (ctx) => this.showStudentMenu(ctx));
    bot.command('teacher', async (ctx) => this.showTeacherMenu(ctx));

    bot.action('sc_student_start', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showStudentMenu(ctx);
    });
    bot.action('sc_teacher_start', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showTeacherMenu(ctx);
    });
    bot.action('sc_find_club', async (ctx) => {
      await ctx.answerCbQuery();
      await this.startFindClub(ctx);
    });
    bot.action(/^sc_select_target_language:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await this.selectTargetLanguage(ctx, ctx.match[1] as SpeakingClubLanguage);
    });
    bot.action(/^sc_teacher_target_language:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await this.selectTeacherTargetLanguage(
        ctx,
        ctx.match[1] as SpeakingClubLanguage,
      );
    });
    bot.action(/^sc_select_support_language:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await this.selectSupportLanguage(ctx, ctx.match[1] as SpeakingClubLanguage);
    });
    bot.action(/^sc_teacher_toggle_support_language:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await this.toggleTeacherSupportLanguage(
        ctx,
        ctx.match[1] as SpeakingClubLanguage,
      );
    });
    bot.action('sc_teacher_support_languages_done', async (ctx) => {
      await ctx.answerCbQuery();
      await this.finishTeacherSupportLanguages(ctx);
    });
    bot.action(/^sc_teacher_toggle_level:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await this.toggleTeacherLevel(ctx, ctx.match[1] as SpeakingClubLevel);
    });
    bot.action('sc_teacher_levels_done', async (ctx) => {
      await ctx.answerCbQuery();
      await this.finishTeacherLevels(ctx);
    });
    bot.action(/^sc_teacher_currency:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await this.selectTeacherCurrency(ctx, ctx.match[1], calendar);
    });
    bot.action(/^sc_teacher_session_timezone:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await this.selectTeacherSessionTimezone(ctx, ctx.match[1]);
    });
    bot.action(/^sc_select_level:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await this.selectLevel(ctx, ctx.match[1] as SpeakingClubLevel);
    });
    bot.action('sc_show_clubs', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showClubs(ctx);
    });
    bot.action(/^sc_book_session:(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await this.bookSession(ctx, Number(ctx.match[1]));
    });
    bot.action(/^sc_confirm_booking:(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply(`Booking confirmed. ID: ${ctx.match[1]}`);
    });
    bot.action(/^sc_pay_booking:(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply(
        `Payment is pending for booking ${ctx.match[1]}. Stripe checkout is not connected yet.`,
      );
    });
    bot.action('sc_my_sessions', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showMySessions(ctx);
    });
    bot.action('sc_teacher_clubs', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showTeacherClubs(ctx);
    });
    bot.action(/^sc_teacher_club:(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await this.showTeacherClubCard(ctx, Number(ctx.match[1]));
    });
    bot.action('sc_create_club', async (ctx) => {
      await ctx.answerCbQuery();
      await this.startCreateClub(ctx);
    });
    bot.action('sc_teacher_analytics', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showTeacherAnalytics(ctx);
    });

    bot.hears(STUDENT_FIND_CLUB, async (ctx) => this.startFindClub(ctx));
    bot.hears(STUDENT_MY_SESSIONS, async (ctx) => this.showMySessions(ctx));
    bot.hears(STUDENT_PAYMENTS, async (ctx) =>
      ctx.reply('Payments are shown on each paid booking.'),
    );
    bot.hears(STUDENT_FAVORITES, async (ctx) =>
      ctx.reply('Favorite clubs are not part of the MVP yet.'),
    );
    bot.hears(STUDENT_SETTINGS, async (ctx) =>
      ctx.reply('Timezone is taken from your profile or session timezone.'),
    );

    bot.hears(TEACHER_MY_CLUBS, async (ctx) => this.showTeacherClubs(ctx));
    bot.hears(TEACHER_CREATE_CLUB, async (ctx) => {
      await this.startCreateClub(ctx);
    });
    bot.hears(TEACHER_STUDENTS, async (ctx) =>
      ctx.reply('Open a club session to see booked students.'),
    );
    bot.hears(TEACHER_ANALYTICS, async (ctx) => this.showTeacherAnalytics(ctx));
    bot.hears(TEACHER_PAYOUTS, async (ctx) =>
      ctx.reply('Payout setup is not connected yet.'),
    );
    bot.hears(TEACHER_SETTINGS, async (ctx) =>
      ctx.reply('Teacher timezone is saved in the teacher profile.'),
    );

    bot.on('callback_query', async (ctx) => {
      const query = ctx.callbackQuery as {
        data?: string;
        message?: { chat: { id: number }; message_id: number };
      };
      if (!query.message) {
        return;
      }

      const calendarMessageId = calendar.chats.get(query.message.chat.id);
      if (query.message.message_id !== calendarMessageId) {
        return;
      }

      const selectedDate = calendar.clickButtonCalendar(query);
      await ctx.answerCbQuery();
      if (selectedDate === -1 || !ctx.from) {
        return;
      }

      await this.selectTeacherSessionDate(ctx, selectedDate);
    });

    bot.on('text', async (ctx) => this.handleTeacherDraft(ctx));
  }

  private async showStudentMenu(ctx) {
    await ctx.reply(
      'Speaking clubs',
      Markup.keyboard([
        [STUDENT_FIND_CLUB, STUDENT_MY_SESSIONS],
        [STUDENT_PAYMENTS, STUDENT_FAVORITES],
        [STUDENT_SETTINGS],
      ]).resize(),
    );
  }

  private async showTeacherMenu(ctx) {
    await ctx.reply(
      'Teacher menu',
      Markup.keyboard([
        [TEACHER_MY_CLUBS, TEACHER_CREATE_CLUB],
        [TEACHER_STUDENTS, TEACHER_ANALYTICS],
        [TEACHER_PAYOUTS, TEACHER_SETTINGS],
      ]).resize(),
    );
  }

  private async startFindClub(ctx) {
    this.studentSearch.set(this.searchKey(ctx), {});
    await ctx.reply(
      'Choose target language',
      Markup.inlineKeyboard([
        this.languageButtons('sc_select_target_language', [
          SpeakingClubLanguage.EN,
          SpeakingClubLanguage.FR,
          SpeakingClubLanguage.DE,
        ]),
        this.languageButtons('sc_select_target_language', [
          SpeakingClubLanguage.ES,
          SpeakingClubLanguage.IT,
        ]),
      ]),
    );
  }

  private async selectTargetLanguage(ctx, language: SpeakingClubLanguage) {
    this.studentSearch.set(this.searchKey(ctx), { targetLanguage: language });
    await ctx.reply(
      'Choose support language',
      Markup.inlineKeyboard([
        this.languageButtons('sc_select_support_language', [
          SpeakingClubLanguage.UA,
          SpeakingClubLanguage.RU,
          SpeakingClubLanguage.EN,
        ]),
        this.languageButtons('sc_select_support_language', [
          SpeakingClubLanguage.FR,
        ]),
      ]),
    );
  }

  private async selectSupportLanguage(ctx, language: SpeakingClubLanguage) {
    const state = this.studentSearch.get(this.searchKey(ctx)) ?? {};
    this.studentSearch.set(this.searchKey(ctx), {
      ...state,
      supportLanguage: language,
    });
    await ctx.reply(
      'Choose level',
      Markup.inlineKeyboard([
        [
          Markup.button.callback('A1', 'sc_select_level:A1'),
          Markup.button.callback('A2', 'sc_select_level:A2'),
          Markup.button.callback('B1', 'sc_select_level:B1'),
        ],
        [
          Markup.button.callback('B2', 'sc_select_level:B2'),
          Markup.button.callback('C1', 'sc_select_level:C1'),
        ],
      ]),
    );
  }

  private async selectLevel(ctx, level: SpeakingClubLevel) {
    const state = this.studentSearch.get(this.searchKey(ctx)) ?? {};
    this.studentSearch.set(this.searchKey(ctx), { ...state, level });
    await this.showClubs(ctx);
  }

  private async showClubs(ctx) {
    const state = this.studentSearch.get(this.searchKey(ctx));
    if (!state?.targetLanguage || !state.supportLanguage || !state.level) {
      await this.startFindClub(ctx);
      return;
    }

    const clubs = await this.speakingClubsService.search(
      state as SearchSpeakingClubsDto,
    );
    if (!clubs.length) {
      await ctx.reply('No active clubs found for this filter.');
      return;
    }

    for (const club of clubs) {
      if (!club.upcomingSessions.length) {
        continue;
      }

      const session = club.upcomingSessions[0];
      await ctx.reply(
        [
          club.title,
          `${club.targetLanguage} ${club.levels.join(', ')}`,
          club.isFree ? 'Free' : `${club.price} ${club.currency}`,
          this.formatDate(session.startAt, session.timezone),
        ].join('\n'),
        Markup.inlineKeyboard([
          Markup.button.callback(
            'Book session',
            `sc_book_session:${session.id}`,
          ),
        ]),
      );
    }
  }

  private async bookSession(ctx, sessionId: number) {
    const result = await this.bookingsService.bookSession({
      sessionId,
      telegramUserId: String(ctx.from.id),
    });
    const booking = result.booking;

    if (booking.status === 'CONFIRMED') {
      await ctx.reply(
        `Booking confirmed. Your personal Zoom link:\n${booking.uniqueZoomUrl}`,
        Markup.inlineKeyboard([
          Markup.button.callback('OK', `sc_confirm_booking:${booking.id}`),
        ]),
      );
      return;
    }

    await ctx.reply(
      `Booking created. Payment is pending. Your personal Zoom link will be generated after payment. Booking ID: ${booking.id}`,
      Markup.inlineKeyboard([
        Markup.button.callback('Pay', `sc_pay_booking:${booking.id}`),
      ]),
    );
  }

  private async showMySessions(ctx) {
    const bookings = await this.bookingsService.listStudentBookings(
      String(ctx.from.id),
    );
    if (!bookings.length) {
      await ctx.reply('You have no speaking club sessions.');
      return;
    }

    await ctx.reply(
      bookings
        .map((booking) =>
          [
            booking.session.club.title,
            this.formatDate(booking.session.startAt, booking.session.timezone),
            booking.status,
          ].join(' - '),
        )
        .join('\n'),
    );
  }

  private async showTeacherClubs(ctx) {
    const clubs = await this.speakingClubsService.listTeacherClubs(
      String(ctx.from.id),
    );
    if (!clubs.length) {
      await ctx.reply('You have no clubs yet.');
      return;
    }

    await ctx.reply(
      'My clubs',
      Markup.inlineKeyboard(
        clubs.map((club) => [
          Markup.button.callback(
            `${club.title} · ${club.targetLanguage} · ${club.levels.join('/')}`,
            `sc_teacher_club:${club.id}`,
          ),
        ]),
      ),
    );
  }

  private async showTeacherClubCard(ctx, clubId: number) {
    const { club, sessions } = await this.speakingClubsService.getTeacherClub(
      String(ctx.from.id),
      clubId,
    );
    const nextSession = sessions[0];
    const confirmedCount = nextSession?.bookings?.length ?? 0;
    const fillRate = Math.round((confirmedCount / club.capacity) * 100);
    const price = club.isFree ? 'Free' : `${club.price} ${club.currency}`;
    const description = club.description?.trim();

    await ctx.reply(
      [
        `📘 ${club.title}`,
        description ?? null,
        '',
        `🌐 Target: ${club.targetLanguage}`,
        `🗣 Support: ${club.supportLanguages.join(', ')}`,
        `🎚 Levels: ${club.levels.join(', ')}`,
        `⏱ Duration: ${club.durationMinutes} min`,
        `💳 Price: ${price}`,
        '',
        nextSession
          ? [
              '📅 Next session',
              this.formatDate(nextSession.startAt, nextSession.timezone),
              `👥 Seats: ${confirmedCount}/${club.capacity} booked (${fillRate}%)`,
            ].join('\n')
          : '📅 No upcoming sessions',
      ]
        .filter((line) => line !== null)
        .join('\n'),
    );
  }

  private async showTeacherAnalytics(ctx) {
    const analytics = await this.analyticsService.getTeacherAnalytics(
      String(ctx.from.id),
    );
    await ctx.reply(
      [
        `Students: ${analytics.totalStudents}`,
        `Bookings: ${analytics.totalBookings}`,
        `Revenue: ${analytics.totalRevenue}`,
        `Fill rate: ${Math.round(analytics.averageFillRate * 100)}%`,
        `Attendance: ${Math.round(analytics.attendanceRate * 100)}%`,
        `No-show: ${Math.round(analytics.noShowRate * 100)}%`,
        `Repeat students: ${analytics.repeatStudentsCount}`,
      ].join('\n'),
    );
  }

  private async startCreateClub(ctx) {
    const teacher = await this.speakingClubsService.getTeacherByTelegramId(
      String(ctx.from.id),
    );
    if (!teacher) {
      this.teacherDrafts.set(this.searchKey(ctx), {
        step: 'displayName',
        data: {},
      });
      await ctx.reply('Enter teacher display name');
      return;
    }

    this.teacherDrafts.set(this.searchKey(ctx), {
      step: 'title',
      teacherId: teacher.id,
      data: {},
    });
    await ctx.reply('Enter club title');
  }

  private async handleTeacherDraft(ctx) {
    const key = this.searchKey(ctx);
    const draft = this.teacherDrafts.get(key);
    if (!draft || !ctx.message?.text) {
      return;
    }

    const text = ctx.message.text.trim();
    if (!text) {
      await ctx.reply('Value is required');
      return;
    }

    if (draft.step === 'displayName') {
      draft.data.displayName = text;
      draft.step = 'timezone';
      await ctx.reply('Enter teacher timezone, for example Europe/Paris');
      return;
    }

    if (draft.step === 'timezone') {
      const teacher = await this.speakingClubsService.createTeacherProfile({
        telegramUserId: String(ctx.from.id),
        displayName: draft.data.displayName!,
        timezone: text,
        bio: null,
      });
      draft.teacherId = teacher.id;
      draft.data.timezone = text;
      draft.step = 'title';
      await ctx.reply('Enter club title');
      return;
    }

    if (draft.step === 'title') {
      draft.data.title = text;
      draft.step = 'description';
      await ctx.reply('Enter club description, or "-" to skip');
      return;
    }
    if (draft.step === 'description') {
      draft.data.description = text === '-' ? null : text;
      draft.step = 'targetLanguage';
      await this.replyTeacherTargetLanguages(ctx);
      return;
    }
    if (draft.step === 'targetLanguage') {
      await this.replyTeacherTargetLanguages(ctx);
      return;
    }
    if (draft.step === 'supportLanguages') {
      await this.replyTeacherSupportLanguages(ctx, draft);
      return;
    }
    if (draft.step === 'level') {
      await this.replyTeacherLevels(ctx, draft);
      return;
    }
    if (draft.step === 'durationMinutes') {
      const value = Number(text);
      if (!Number.isInteger(value) || value < 15) {
        await ctx.reply('Duration must be at least 15 minutes');
        return;
      }
      draft.data.durationMinutes = value;
      draft.step = 'capacity';
      await ctx.reply('Enter capacity');
      return;
    }
    if (draft.step === 'capacity') {
      const value = Number(text);
      if (!Number.isInteger(value) || value < 1) {
        await ctx.reply('Capacity must be positive');
        return;
      }
      draft.data.capacity = value;
      draft.step = 'price';
      await ctx.reply('Enter price in minor units, or 0 for free');
      return;
    }
    if (draft.step === 'price') {
      const value = Number(text);
      if (!Number.isInteger(value) || value < 0) {
        await ctx.reply('Price must be 0 or a positive integer');
        return;
      }
      draft.data.price = value;
      draft.data.isFree = value === 0;
      draft.step = 'currency';
      await this.replyTeacherCurrencies(ctx);
      return;
    }
    if (draft.step === 'currency') {
      await this.replyTeacherCurrencies(ctx);
      return;
    }
    if (draft.step === 'sessionStartAt') {
      await ctx.reply('Choose the date and time in the calendar.');
      return;
    }
    if (draft.step === 'sessionTimezone') {
      await this.replyTeacherSessionTimezones(ctx);
      return;
    }
  }

  private parseLanguage(value: string) {
    const normalized = value.trim().toUpperCase();
    return Object.values(SpeakingClubLanguage).find(
      (language) => language === normalized,
    );
  }

  private parseLevel(value: string) {
    const normalized = value.trim().toUpperCase();
    return Object.values(SpeakingClubLevel).find((level) => level === normalized);
  }

  private languageButtons(prefix: string, languages: SpeakingClubLanguage[]) {
    return languages.map((language) =>
      Markup.button.callback(
        `${LANGUAGE_FLAGS[language]} ${language}`,
        `${prefix}:${language}`,
      ),
    );
  }

  private async replyTeacherTargetLanguages(ctx) {
    await ctx.reply(
      'Choose target language',
      Markup.inlineKeyboard([
        this.languageButtons('sc_teacher_target_language', [
          SpeakingClubLanguage.EN,
          SpeakingClubLanguage.FR,
          SpeakingClubLanguage.DE,
        ]),
        this.languageButtons('sc_teacher_target_language', [
          SpeakingClubLanguage.ES,
          SpeakingClubLanguage.IT,
        ]),
      ]),
    );
  }

  private async selectTeacherTargetLanguage(
    ctx,
    language: SpeakingClubLanguage,
  ) {
    if (!TARGET_LANGUAGE_OPTIONS.includes(language)) {
      await ctx.reply('Choose one of the available target languages.');
      await this.replyTeacherTargetLanguages(ctx);
      return;
    }

    const draft = this.teacherDrafts.get(this.searchKey(ctx));
    if (!draft || draft.step !== 'targetLanguage') {
      return;
    }

    draft.data.targetLanguage = language;
    draft.step = 'supportLanguages';
    draft.data.supportLanguages = [];
    await this.replyTeacherSupportLanguages(ctx, draft);
  }

  private async replyTeacherSupportLanguages(ctx, draft: TeacherDraft) {
    const selected = draft.data.supportLanguages ?? [];
    await ctx.reply(
      'Choose support languages',
      Markup.inlineKeyboard([
        SUPPORT_LANGUAGE_OPTIONS.slice(0, 3).map((language) =>
          Markup.button.callback(
            `${selected.includes(language) ? '✓ ' : ''}${LANGUAGE_FLAGS[language]} ${language}`,
            `sc_teacher_toggle_support_language:${language}`,
          ),
        ),
        SUPPORT_LANGUAGE_OPTIONS.slice(3).map((language) =>
          Markup.button.callback(
            `${selected.includes(language) ? '✓ ' : ''}${LANGUAGE_FLAGS[language]} ${language}`,
            `sc_teacher_toggle_support_language:${language}`,
          ),
        ),
        [Markup.button.callback('Done', 'sc_teacher_support_languages_done')],
      ]),
    );
  }

  private async toggleTeacherSupportLanguage(
    ctx,
    language: SpeakingClubLanguage,
  ) {
    if (!SUPPORT_LANGUAGE_OPTIONS.includes(language)) {
      return;
    }

    const draft = this.teacherDrafts.get(this.searchKey(ctx));
    if (!draft || draft.step !== 'supportLanguages') {
      return;
    }

    const selected = draft.data.supportLanguages ?? [];
    draft.data.supportLanguages = selected.includes(language)
      ? selected.filter((item) => item !== language)
      : [...selected, language];
    await this.replyTeacherSupportLanguages(ctx, draft);
  }

  private async finishTeacherSupportLanguages(ctx) {
    const draft = this.teacherDrafts.get(this.searchKey(ctx));
    if (!draft || draft.step !== 'supportLanguages') {
      return;
    }

    if (!draft.data.supportLanguages?.length) {
      await ctx.reply('Choose at least one support language.');
      await this.replyTeacherSupportLanguages(ctx, draft);
      return;
    }

    draft.step = 'level';
    draft.data.levels = [];
    await this.replyTeacherLevels(ctx, draft);
  }

  private async replyTeacherLevels(ctx, draft: TeacherDraft) {
    const selected = draft.data.levels ?? [];
    await ctx.reply(
      'Choose levels',
      Markup.inlineKeyboard([
        LEVEL_OPTIONS.slice(0, 3).map((level) =>
          Markup.button.callback(
            `${selected.includes(level) ? '✓ ' : ''}${level}`,
            `sc_teacher_toggle_level:${level}`,
          ),
        ),
        LEVEL_OPTIONS.slice(3).map((level) =>
          Markup.button.callback(
            `${selected.includes(level) ? '✓ ' : ''}${level}`,
            `sc_teacher_toggle_level:${level}`,
          ),
        ),
        [Markup.button.callback('Done', 'sc_teacher_levels_done')],
      ]),
    );
  }

  private async toggleTeacherLevel(ctx, level: SpeakingClubLevel) {
    if (!LEVEL_OPTIONS.includes(level)) {
      return;
    }

    const draft = this.teacherDrafts.get(this.searchKey(ctx));
    if (!draft || draft.step !== 'level') {
      return;
    }

    const selected = draft.data.levels ?? [];
    draft.data.levels = selected.includes(level)
      ? selected.filter((item) => item !== level)
      : [...selected, level];
    await this.replyTeacherLevels(ctx, draft);
  }

  private async finishTeacherLevels(ctx) {
    const draft = this.teacherDrafts.get(this.searchKey(ctx));
    if (!draft || draft.step !== 'level') {
      return;
    }

    if (!draft.data.levels?.length) {
      await ctx.reply('Choose at least one level.');
      await this.replyTeacherLevels(ctx, draft);
      return;
    }

    draft.step = 'durationMinutes';
    await ctx.reply('Enter duration in minutes');
  }

  private async replyTeacherCurrencies(ctx) {
    await ctx.reply(
      'Choose currency',
      Markup.inlineKeyboard([
        CURRENCY_OPTIONS.map((currency) =>
          Markup.button.callback(currency, `sc_teacher_currency:${currency}`),
        ),
      ]),
    );
  }

  private async selectTeacherCurrency(ctx, currency: string, calendar: Calendar) {
    if (!CURRENCY_OPTIONS.includes(currency)) {
      return;
    }

    const draft = this.teacherDrafts.get(this.searchKey(ctx));
    if (!draft || draft.step !== 'currency') {
      return;
    }

    draft.data.currency = currency;
    const club = await this.speakingClubsService.createClub({
      teacherId: draft.teacherId!,
      title: draft.data.title!,
      description: draft.data.description ?? null,
      targetLanguage: draft.data.targetLanguage!,
      supportLanguages: draft.data.supportLanguages!,
      levels: draft.data.levels!,
      durationMinutes: draft.data.durationMinutes!,
      capacity: draft.data.capacity!,
      price: draft.data.price,
      currency: draft.data.currency,
      isFree: draft.data.isFree!,
    });
    draft.clubId = club.id;
    draft.step = 'sessionStartAt';
    await ctx.reply(
      `Club created: ${club.title}`,
    );
    calendar.startNavCalendar(ctx.callbackQuery?.message ?? ctx.message);
  }

  private async selectTeacherSessionDate(ctx, selectedDate: string) {
    const draft = this.teacherDrafts.get(this.searchKey(ctx));
    if (!draft || draft.step !== 'sessionStartAt') {
      return;
    }

    const startAt = this.calendarDateToIso(selectedDate);
    if (!startAt) {
      await ctx.reply('Invalid selected date.');
      return;
    }

    draft.data.sessionStartAt = startAt;
    draft.step = 'sessionTimezone';
    await this.replyTeacherSessionTimezones(ctx);
  }

  private async replyTeacherSessionTimezones(ctx) {
    await ctx.reply(
      'Choose session timezone',
      Markup.inlineKeyboard([
        TIMEZONE_OPTIONS.slice(0, 2).map((timezone) =>
          Markup.button.callback(
            timezone,
            `sc_teacher_session_timezone:${timezone}`,
          ),
        ),
        TIMEZONE_OPTIONS.slice(2, 4).map((timezone) =>
          Markup.button.callback(
            timezone,
            `sc_teacher_session_timezone:${timezone}`,
          ),
        ),
        TIMEZONE_OPTIONS.slice(4).map((timezone) =>
          Markup.button.callback(
            timezone,
            `sc_teacher_session_timezone:${timezone}`,
          ),
        ),
      ]),
    );
  }

  private async selectTeacherSessionTimezone(ctx, timezone: string) {
    if (!TIMEZONE_OPTIONS.includes(timezone)) {
      return;
    }

    const draft = this.teacherDrafts.get(this.searchKey(ctx));
    if (!draft || draft.step !== 'sessionTimezone') {
      return;
    }

    draft.data.sessionTimezone = timezone;
    const session = await this.speakingClubsService.createSession({
      clubId: draft.clubId!,
      startAt: draft.data.sessionStartAt!,
      timezone: draft.data.sessionTimezone,
    });
    this.teacherDrafts.delete(this.searchKey(ctx));
    await ctx.reply(
      `Session created at ${this.formatDate(session.startAt, session.timezone)}`,
    );
  }

  private calendarDateToIso(value: string) {
    const match = value.match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/,
    );
    if (!match) {
      return null;
    }

    const [, year, month, day, hour, minute] = match;
    return new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
      ),
    ).toISOString();
  }

  private formatDate(date: Date, timeZone: string) {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(date));
  }

  private searchKey(ctx) {
    return `${ctx.chat?.id}:${ctx.from?.id}`;
  }

  private getMode(): SpeakingClubBotMode {
    return process.env.SPEAKING_CLUBS_TELEGRAM_MODE === 'webhook'
      ? 'webhook'
      : 'polling';
  }
}
