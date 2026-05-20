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
  SessionBookingStatus,
} from '../entities/speaking-club.enums';
import { SpeakingClubAnalyticsService } from '../speaking-club-analytics.service';
import { SpeakingClubBookingsService } from '../speaking-club-bookings.service';
import { SpeakingClubsService } from '../speaking-clubs.service';

type SpeakingClubBotMode = 'polling' | 'webhook';
type StudentSearchState = Partial<SearchSpeakingClubsDto>;
type TeacherDraftStep =
  | 'displayName'
  | 'title'
  | 'description'
  | 'targetLanguage'
  | 'supportLanguages'
  | 'level'
  | 'durationMinutes'
  | 'capacity'
  | 'price'
  | 'currency'
  | 'sessionStartAt';
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

  async sendMessage(telegramUserId: string, text: string) {
    if (!this.bot) {
      this.logger.warn('Speaking clubs bot is not initialized. Message skipped.');
      return;
    }

    await this.bot.telegram.sendMessage(telegramUserId, text);
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
      if (ctx.from) {
        await this.speakingClubsService.registerTelegramStudent({
          telegramId: String(ctx.from.id),
          firstName: ctx.from.first_name ?? null,
          username: ctx.from.username ?? null,
        });
      }
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
      await this.toggleSupportLanguage(ctx, ctx.match[1] as SpeakingClubLanguage);
    });
    bot.action('sc_support_languages_done', async (ctx) => {
      await ctx.answerCbQuery();
      await this.finishSupportLanguages(ctx);
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
    bot.action(/^sc_set_timezone:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await this.setUserTimezone(ctx, ctx.match[1]);
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
    bot.action(/^sc_teacher_add_session:(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await this.startCreateSessionForClub(ctx, Number(ctx.match[1]), calendar);
    });
    bot.action(/^sc_teacher_club_sessions:(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await this.showTeacherClubSessions(ctx, Number(ctx.match[1]));
    });
    bot.action(/^sc_teacher_session:(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      await this.showTeacherSessionCard(ctx, Number(ctx.match[1]));
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
      ctx.reply('Will be available soon'),
    );
    bot.hears(STUDENT_SETTINGS, async (ctx) =>
      this.replyUserTimezones(ctx),
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
      this.replyUserTimezones(ctx),
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
        [STUDENT_FAVORITES, STUDENT_SETTINGS],
      ]).resize(),
    );
  }

  private async showTeacherMenu(ctx) {
    await ctx.reply(
      'Teacher menu',
      Markup.keyboard([
        [TEACHER_MY_CLUBS, TEACHER_CREATE_CLUB],
        [TEACHER_ANALYTICS, TEACHER_SETTINGS],
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
    this.studentSearch.set(this.searchKey(ctx), {
      targetLanguage: language,
      supportLanguages: [],
    });
    await this.replyStudentSupportLanguages(ctx);
  }

  private async replyStudentSupportLanguages(ctx) {
    const state = this.studentSearch.get(this.searchKey(ctx)) ?? {};
    const selected = state.supportLanguages ?? [];
    await ctx.reply(
      'Choose support languages',
      Markup.inlineKeyboard([
        SUPPORT_LANGUAGE_OPTIONS.slice(0, 3).map((language) =>
          Markup.button.callback(
            `${selected.includes(language) ? '✓ ' : ''}${LANGUAGE_FLAGS[language]} ${language}`,
            `sc_select_support_language:${language}`,
          ),
        ),
        SUPPORT_LANGUAGE_OPTIONS.slice(3).map((language) =>
          Markup.button.callback(
            `${selected.includes(language) ? '✓ ' : ''}${LANGUAGE_FLAGS[language]} ${language}`,
            `sc_select_support_language:${language}`,
          ),
        ),
        [Markup.button.callback('Done', 'sc_support_languages_done')],
      ]),
    );
  }

  private async toggleSupportLanguage(ctx, language: SpeakingClubLanguage) {
    if (!SUPPORT_LANGUAGE_OPTIONS.includes(language)) {
      return;
    }

    const state = this.studentSearch.get(this.searchKey(ctx)) ?? {};
    const selected = state.supportLanguages ?? [];
    this.studentSearch.set(this.searchKey(ctx), {
      ...state,
      supportLanguages: selected.includes(language)
        ? selected.filter((item) => item !== language)
        : [...selected, language],
    });
    await this.replyStudentSupportLanguages(ctx);
  }

  private async finishSupportLanguages(ctx) {
    const state = this.studentSearch.get(this.searchKey(ctx)) ?? {};
    if (!state.supportLanguages?.length) {
      await ctx.reply('Choose at least one support language.');
      await this.replyStudentSupportLanguages(ctx);
      return;
    }

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
    if (
      !state?.targetLanguage ||
      !state.supportLanguages?.length ||
      !state.level
    ) {
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

    const timezone = await this.speakingClubsService.getUserTimezone(
      String(ctx.from.id),
    );
    for (const club of clubs) {
      const session = club.upcomingSessions[0];
      const bookedCount = session?.bookings?.length ?? 0;
      const price = club.isFree ? 'Free' : `${club.price} ${club.currency}`;
      const lines = [
        `📘 ${club.title}`,
        `🌐 ${club.targetLanguage} · ${club.levels.join(', ')}`,
        `🗣 Support: ${club.supportLanguages.join(', ')}`,
        session ? `📅 ${this.formatDate(session.startAt, timezone)}` : null,
        `⏱ ${club.durationMinutes} min · ${price}`,
        session ? `👥 Seats: ${bookedCount}/${club.capacity}` : null,
        club.description?.trim() ? `📝 ${club.description.trim()}` : null,
      ]
        .filter((line) => line !== null)
        .join('\n');

      if (!session) {
        await ctx.reply(lines);
        continue;
      }

      await ctx.reply(
        lines,
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

    const timezone = await this.speakingClubsService.getUserTimezone(
      String(ctx.from.id),
    );
    for (const booking of bookings) {
      const session = booking.session;
      const club = session.club;
      const price = club.isFree ? 'Free' : `${club.price} ${club.currency}`;
      const lines = [
        club.title,
        `${club.targetLanguage} · ${club.levels.join(', ')}`,
        this.formatDate(session.startAt, timezone),
        `${club.durationMinutes} min · ${price}`,
        `Booking: ${booking.status}`,
        `Payment: ${booking.paymentStatus}`,
      ];
      const buttons =
        booking.status === SessionBookingStatus.Confirmed
          ? this.buildStudentSessionButtons(booking)
          : [[Markup.button.callback('Pay', `sc_pay_booking:${booking.id}`)]];
      if (
        booking.status === SessionBookingStatus.Confirmed &&
        booking.uniqueZoomUrl &&
        !this.canUseTelegramUrlButton(booking.uniqueZoomUrl)
      ) {
        lines.push(`Link: ${booking.uniqueZoomUrl}`);
      }

      await this.replyWithOptionalKeyboard(ctx, lines.join('\n'), buttons);
    }
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
    const timezone = await this.speakingClubsService.getUserTimezone(
      String(ctx.from.id),
    );
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
              this.formatDate(nextSession.startAt, timezone),
              `👥 Seats: ${confirmedCount}/${club.capacity} booked (${fillRate}%)`,
            ].join('\n')
          : '📅 No upcoming sessions',
      ]
        .filter((line) => line !== null)
        .join('\n'),
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            'View sessions',
            `sc_teacher_club_sessions:${club.id}`,
          ),
        ],
        [
          Markup.button.callback(
            'Add session',
            `sc_teacher_add_session:${club.id}`,
          ),
        ],
      ]),
    );
  }

  private async startCreateSessionForClub(ctx, clubId: number, calendar: Calendar) {
    const { club } = await this.speakingClubsService.getTeacherClub(
      String(ctx.from.id),
      clubId,
    );
    const timezone = await this.speakingClubsService.getUserTimezone(
      String(ctx.from.id),
      '',
    );
    if (!timezone) {
      await ctx.reply('Set your timezone first.');
      await this.replyUserTimezones(ctx);
      return;
    }

    this.teacherDrafts.set(this.searchKey(ctx), {
      step: 'sessionStartAt',
      clubId: club.id,
      data: {},
    });
    await ctx.reply(`Choose date and time for ${club.title}`);
    calendar.startNavCalendar(ctx.callbackQuery?.message ?? ctx.message);
  }

  private async showTeacherClubSessions(ctx, clubId: number) {
    const timezone = await this.speakingClubsService.getUserTimezone(
      String(ctx.from.id),
    );
    const sessions = await this.speakingClubsService.listTeacherClubSessions(
      String(ctx.from.id),
      clubId,
    );
    if (!sessions.length) {
      await ctx.reply('This club has no sessions yet.');
      return;
    }

    await ctx.reply(
      'Sessions',
      Markup.inlineKeyboard(
        sessions.map((session) => [
          Markup.button.callback(
            [
              `#${session.id}`,
              this.formatDate(session.startAt, timezone),
              session.status,
              `${session.bookings?.length ?? 0} bookings`,
            ].join(' - '),
            `sc_teacher_session:${session.id}`,
          ),
        ]),
      ),
    );
  }

  private async showTeacherSessionCard(ctx, sessionId: number) {
    const timezone = await this.speakingClubsService.getUserTimezone(
      String(ctx.from.id),
    );
    const session = await this.speakingClubsService.getTeacherClubSession(
      String(ctx.from.id),
      sessionId,
    );
    const bookings = session.bookings ?? [];
    const bookedCount = bookings.length;
    const capacity = session.club.capacity;
    const fillRate = Math.round((bookedCount / capacity) * 100);
    const students = bookings.length
      ? bookings
          .map((booking, index) =>
            [
              `${index + 1}. ${this.formatStudentLink(booking.student)}`,
              `booking #${booking.id}`,
              this.escapeHtml(booking.status),
              this.escapeHtml(booking.paymentStatus),
            ].join(' - '),
          )
          .join('\n')
      : 'No bookings yet.';

    await ctx.reply(
      [
        `Session #${session.id}`,
        this.escapeHtml(session.club.title),
        this.escapeHtml(this.formatDate(session.startAt, timezone)),
        `Status: ${this.escapeHtml(session.status)}`,
        `Seats: ${bookedCount}/${capacity} booked (${fillRate}%)`,
        `Zoom meeting: ${this.escapeHtml(session.zoomMeetingId ?? 'not set')}`,
        session.zoomJoinUrl
          ? `Zoom link: ${this.escapeHtml(session.zoomJoinUrl)}`
          : null,
        '',
        'Booked students',
        students,
      ]
        .filter((line) => line !== null)
        .join('\n'),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              'Back to sessions',
              `sc_teacher_club_sessions:${session.club.id}`,
            ),
          ],
        ]),
      },
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

  private async replyUserTimezones(ctx) {
    await ctx.reply(
      'Choose timezone',
      Markup.inlineKeyboard([
        TIMEZONE_OPTIONS.slice(0, 2).map((timezone) =>
          Markup.button.callback(timezone, `sc_set_timezone:${timezone}`),
        ),
        TIMEZONE_OPTIONS.slice(2, 4).map((timezone) =>
          Markup.button.callback(timezone, `sc_set_timezone:${timezone}`),
        ),
        TIMEZONE_OPTIONS.slice(4).map((timezone) =>
          Markup.button.callback(timezone, `sc_set_timezone:${timezone}`),
        ),
      ]),
    );
  }

  private async setUserTimezone(ctx, timezone: string) {
    if (!TIMEZONE_OPTIONS.includes(timezone)) {
      return;
    }

    await this.speakingClubsService.setUserTimezone(String(ctx.from.id), timezone);
    await ctx.reply(`Timezone saved: ${timezone}`);

    const draft = this.teacherDrafts.get(this.searchKey(ctx));
    if (draft?.step === 'displayName' && draft.data.displayName) {
      const teacher = await this.speakingClubsService.createTeacherProfile({
        telegramUserId: String(ctx.from.id),
        displayName: draft.data.displayName,
        timezone,
        bio: null,
      });
      draft.teacherId = teacher.id;
      draft.step = 'title';
      await this.replyClubTitlePrompt(ctx);
    }
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

    if (!teacher.user?.timezone) {
      await ctx.reply('Set your timezone first.');
      await this.replyUserTimezones(ctx);
      return;
    }

    this.teacherDrafts.set(this.searchKey(ctx), {
      step: 'title',
      teacherId: teacher.id,
      data: {},
    });
    await this.replyClubTitlePrompt(ctx);
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
      const timezone = await this.speakingClubsService.getUserTimezone(
        String(ctx.from.id),
        '',
      );
      if (!timezone) {
        await ctx.reply('Set your timezone first.');
        await this.replyUserTimezones(ctx);
        return;
      }
      const teacher = await this.speakingClubsService.createTeacherProfile({
        telegramUserId: String(ctx.from.id),
        displayName: draft.data.displayName!,
        timezone,
        bio: null,
      });
      draft.teacherId = teacher.id;
      draft.step = 'title';
      await this.replyClubTitlePrompt(ctx);
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
  }

  private async replyClubTitlePrompt(ctx) {
    await ctx.reply('What should students see as the club name?');
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

    const timezone = await this.speakingClubsService.getUserTimezone(
      String(ctx.from.id),
      '',
    );
    if (!timezone) {
      await ctx.reply('Set your timezone first.');
      await this.replyUserTimezones(ctx);
      return;
    }

    const startAt = this.calendarDateToIso(selectedDate, timezone);
    if (!startAt) {
      await ctx.reply('Invalid selected date.');
      return;
    }

    draft.data.sessionStartAt = startAt;
    const session = await this.speakingClubsService.createSession({
      clubId: draft.clubId!,
      startAt: draft.data.sessionStartAt!,
      timezone,
    });
    this.teacherDrafts.delete(this.searchKey(ctx));
    await ctx.reply(
      `Session created at ${this.formatDate(session.startAt, timezone)}`,
    );
  }

  private calendarDateToIso(value: string, timeZone: string) {
    const match = value.match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/,
    );
    if (!match) {
      return null;
    }

    const [, year, month, day, hour, minute] = match;
    return this.zonedDateTimeToUtcIso(
      Number(year),
      Number(month),
      Number(day),
      Number(hour),
      Number(minute),
      timeZone,
    );
  }

  private formatDate(date: Date, timeZone: string) {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(date));
  }

  private buildStudentSessionButtons(booking) {
    if (
      booking.uniqueZoomUrl &&
      this.canUseTelegramUrlButton(booking.uniqueZoomUrl)
    ) {
      return [[Markup.button.url('Open Zoom', booking.uniqueZoomUrl)]];
    }

    return [];
  }

  private async replyWithOptionalKeyboard(ctx, text: string, buttons) {
    if (!buttons.length) {
      await ctx.reply(text);
      return;
    }

    await ctx.reply(text, Markup.inlineKeyboard(buttons));
  }

  private canUseTelegramUrlButton(value: string) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private zonedDateTimeToUtcIso(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    timeZone: string,
  ) {
    const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
    let utc = localAsUtc - this.getTimeZoneOffsetMs(timeZone, new Date(localAsUtc));
    utc = localAsUtc - this.getTimeZoneOffsetMs(timeZone, new Date(utc));
    return new Date(utc).toISOString();
  }

  private getTimeZoneOffsetMs(timeZone: string, date: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );

    const zonedAsUtc = Date.UTC(
      values.year,
      values.month - 1,
      values.day,
      values.hour,
      values.minute,
      values.second,
    );
    return zonedAsUtc - date.getTime();
  }

  private formatStudentLink(student) {
    const name = this.escapeHtml(this.formatStudentName(student));
    return `<a href="tg://user?id=${student.telegramUserId}">${name}</a>`;
  }

  private formatStudentName(student) {
    if (student.user?.firstName) {
      return student.user.firstName;
    }
    if (student.user?.username) {
      return `@${student.user.username}`;
    }
    return `Telegram ${student.telegramUserId}`;
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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
