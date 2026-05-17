import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Markup, Telegraf } from 'telegraf';
import { LogsService } from '../app-logs/logs.service';
import {
  BotSettings,
  EventAnnouncementMode,
  Organization,
} from '../organizations/entities/organization.entity';
import { OrganizationUserRole } from '../organizations/entities/organization-user.entity';
import { OrganizationsService } from '../organizations/organizations.service';
import { EventsService, EventListItem } from '../events/events.service';
import { Event } from '../events/entities/event.entity';
import { Participant } from '../participants/entities/participant.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { Waitlist } from '../waitlist/entities/waitlist.entity';

type BotContext = {
  organization: Organization;
  settings: BotSettings;
};

type AdminDraft = {
  organizationId: number;
  userId: number;
  step:
    | 'title'
    | 'description'
    | 'startsAt'
    | 'capacity'
    | 'teacher'
    | 'locationOrZoomLink';
  data: Partial<{
    title: string;
    description: string | null;
    startsAt: string;
    capacity: number;
    teacher: string;
    locationOrZoomLink: string;
  }>;
};

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly bots = new Map<number, Telegraf>();
  private readonly adminDrafts = new Map<string, AdminDraft>();

  constructor(
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
    private readonly logsService: LogsService,
    @Inject(forwardRef(() => EventsService))
    private readonly eventsService: EventsService,
  ) {}

  async onModuleInit() {
    if (process.env.SCHEDULER_TELEGRAM_POLLING !== 'true') {
      this.logger.log(
        'Scheduler Telegram polling is disabled. Set SCHEDULER_TELEGRAM_POLLING=true to enable it.',
      );
      return;
    }

    const organization = await this.organizationsService.findOrCreateDefault();
    if (!organization) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN is not set. Default polling bot is disabled. Webhook bots can still be handled from organizations.',
      );
      return;
    }

    const bot = await this.getBot(organization);
    await bot.launch();
    this.logger.log(`Default Telegram bot started for organization ${organization.id}`);
  }

  async onModuleDestroy() {
    for (const bot of this.bots.values()) {
      bot.stop('Nest application shutdown');
    }
  }

  async handleWebhook(organizationId: number, update: unknown) {
    const organization = await this.organizationsService.findOneOrFail(organizationId);
    const bot = await this.getBot(organization);
    await bot.handleUpdate(update as never);
  }

  async setWebhook(organizationId: number, baseUrl: string) {
    const organization = await this.organizationsService.findOneOrFail(organizationId);
    const bot = await this.getBot(organization);
    const url = `${baseUrl.replace(/\/$/, '')}/scheduler/telegram/webhook/${organization.id}`;
    await bot.telegram.setWebhook(url);
    return url;
  }

  async sendWaitlistInvite(waitlist: Waitlist) {
    const organization = waitlist.event.organization;
    const bot = await this.getBot(organization);
    const settings = organization.settings;

    await bot.telegram.sendMessage(
      waitlist.user.telegramId,
      `A spot is available for "${waitlist.event.title}". Do you want to join?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('Accept', `wait_accept:${waitlist.event.id}`),
          Markup.button.callback('Decline', `wait_decline:${waitlist.event.id}`),
        ],
      ]),
    );
  }

  async notifyUsers(telegramIds: string[], message: string, organizationId: number) {
    const organization = await this.organizationsService.findOneOrFail(organizationId);
    const bot = await this.getBot(organization);

    for (const telegramId of new Set(telegramIds)) {
      await bot.telegram.sendMessage(telegramId, message);
    }
  }

  async announceNewEvent(
    telegramIds: string[],
    event: Event,
    organizationId: number,
  ) {
    const organization = await this.organizationsService.findOneOrFail(organizationId);
    const bot = await this.getBot(organization);
    const message = this.formatNewEventAnnouncement(event);

    for (const telegramId of new Set(telegramIds)) {
      await bot.telegram.sendMessage(
        telegramId,
        message,
        Markup.inlineKeyboard([
          Markup.button.callback('Join', `join:${event.id}`),
        ]),
      );
    }
  }

  private async getBot(organization: Organization): Promise<Telegraf> {
    const existing = this.bots.get(organization.id);
    if (existing) {
      return existing;
    }

    const bot = new Telegraf(organization.botToken);
    this.registerHandlers(bot, {
      organization,
      settings: organization.settings,
    });
    this.bots.set(organization.id, bot);
    return bot;
  }

  private registerHandlers(bot: Telegraf, botContext: BotContext) {
    const { settings } = botContext;

    bot.start(async (ctx) => {
        await this.safeReply(ctx, botContext, async () => {
        await this.showHome(ctx, botContext);
      });
    });

    bot.command('events', async (ctx) =>
      this.safeReply(ctx, botContext, () => this.replyEvents(ctx, botContext)),
    );
    bot.command('mybookings', async (ctx) =>
      this.safeReply(ctx, botContext, () => this.replyMyBookings(ctx, botContext)),
    );
    bot.command('mywaitlist', async (ctx) =>
      this.safeReply(ctx, botContext, () => this.replyMyWaitlist(ctx, botContext)),
    );
    bot.command('admin', async (ctx) =>
      this.safeReply(ctx, botContext, () => this.replyAdmin(ctx, botContext)),
    );
    bot.command('start', async (ctx) =>
      this.safeReply(ctx, botContext, () => this.showHome(ctx, botContext)),
    );

    bot.hears(settings.menu.homeLabel, async (ctx) =>
      this.safeReply(ctx, botContext, () => this.showHome(ctx, botContext)),
    );
    bot.hears(settings.menu.backLabel, async (ctx) =>
      this.safeReply(ctx, botContext, () => this.showHome(ctx, botContext)),
    );
    bot.hears(settings.menu.adminLabel, async (ctx) =>
      this.safeReply(ctx, botContext, () => this.replyAdmin(ctx, botContext)),
    );
    bot.hears(settings.menu.eventsLabel, async (ctx) =>
      this.safeReply(ctx, botContext, () => this.replyEvents(ctx, botContext)),
    );
    bot.hears(settings.menu.bookingsLabel, async (ctx) =>
      this.safeReply(ctx, botContext, () => this.replyMyBookings(ctx, botContext)),
    );
    bot.hears(settings.menu.waitlistLabel, async (ctx) =>
      this.safeReply(ctx, botContext, () => this.replyMyWaitlist(ctx, botContext)),
    );
    bot.hears(settings.menu.createEventLabel, async (ctx) =>
      this.safeReply(ctx, botContext, () => this.startCreateEvent(ctx, botContext)),
    );
    bot.hears(settings.menu.myEventsLabel, async (ctx) =>
      this.safeReply(ctx, botContext, () => this.replyAdminEvents(ctx, botContext)),
    );

    bot.action(/^join:(\d+)$/, async (ctx) => {
      await this.safeReply(ctx, botContext, async () => {
        const { user } = await this.ensureMembership(ctx.from, botContext);
        const eventId = Number(ctx.match[1]);
        const result = await this.eventsService.joinEvent(
          user.id,
          eventId,
          botContext.organization.id,
        );
        await ctx.answerCbQuery();
        if (result.status === 'CONFIRMED') {
          await ctx.reply(`${settings.texts.confirmed}: ${result.event.title}`);
        } else {
          await ctx.reply(
            `${settings.texts.waitlistJoined}. Position: ${result.waitlist.position}.`,
          );
        }
      });
    });

    bot.action(/^wait:(\d+)$/, async (ctx) => {
      await this.safeReply(ctx, botContext, async () => {
        const { user } = await this.ensureMembership(ctx.from, botContext);
        const waitlist = await this.eventsService.joinWaitlist(
          user.id,
          Number(ctx.match[1]),
          botContext.organization.id,
        );
        await ctx.answerCbQuery();
        await ctx.reply(`${settings.texts.waitlistJoined}. Position: ${waitlist.position}.`);
      });
    });

    bot.action(/^cancel:(\d+)$/, async (ctx) => {
      await this.safeReply(ctx, botContext, async () => {
        const { user } = await this.ensureMembership(ctx.from, botContext);
        await this.eventsService.cancelBooking(
          user.id,
          Number(ctx.match[1]),
          botContext.organization.id,
        );
        await ctx.answerCbQuery();
        await ctx.reply('Booking cancelled.');
      });
    });

    bot.action(/^wait_accept:(\d+)$/, async (ctx) => {
      await this.safeReply(ctx, botContext, async () => {
        const { user } = await this.ensureMembership(ctx.from, botContext);
        const result = await this.eventsService.acceptWaitlistInvite(
          user.id,
          Number(ctx.match[1]),
          botContext.organization.id,
        );
        await ctx.answerCbQuery();
        await ctx.reply(
          result.accepted ? settings.texts.confirmed : `Invite not accepted: ${result.reason}.`,
        );
      });
    });

    bot.action(/^wait_decline:(\d+)$/, async (ctx) => {
      await this.safeReply(ctx, botContext, async () => {
        const { user } = await this.ensureMembership(ctx.from, botContext);
        await this.eventsService.declineWaitlistInvite(
          user.id,
          Number(ctx.match[1]),
          botContext.organization.id,
        );
        await ctx.answerCbQuery();
        await ctx.reply('Invite declined.');
      });
    });

    bot.action(/^admin_participants:(\d+)$/, async (ctx) => {
      await this.safeReply(ctx, botContext, async () => {
        await this.assertAdmin(ctx, botContext);
        const participants = await this.eventsService.listParticipants(
          Number(ctx.match[1]),
          botContext.organization.id,
        );
        await ctx.answerCbQuery();
        await ctx.reply(
          participants.length
            ? participants.map((item) => this.formatUserLine(item.user)).join('\n')
            : 'No confirmed participants.',
        );
      });
    });

    bot.action(/^admin_waitlist:(\d+)$/, async (ctx) => {
      await this.safeReply(ctx, botContext, async () => {
        await this.assertAdmin(ctx, botContext);
        const waitlist = await this.eventsService.listWaitlist(
          Number(ctx.match[1]),
          botContext.organization.id,
        );
        await ctx.answerCbQuery();
        await ctx.reply(
          waitlist.length
            ? waitlist
                .map((item) => `${item.position}. ${this.formatUserLine(item.user)} (${item.status})`)
                .join('\n')
            : 'Waitlist is empty.',
        );
      });
    });

    bot.action(/^admin_cancel:(\d+)$/, async (ctx) => {
      await this.safeReply(ctx, botContext, async () => {
        await this.assertAdmin(ctx, botContext);
        const event = await this.eventsService.cancelEvent(
          Number(ctx.match[1]),
          botContext.organization.id,
        );
        await ctx.answerCbQuery();
        await ctx.reply(`Cancelled: ${event.title}`);
      });
    });

    bot.action(/^admin_reminder:(\d+)$/, async (ctx) => {
      await this.safeReply(ctx, botContext, async () => {
        await this.assertAdmin(ctx, botContext);
        const count = await this.eventsService.sendReminder(
          Number(ctx.match[1]),
          botContext.organization.id,
        );
        await ctx.answerCbQuery();
        await ctx.reply(`Reminder sent to ${count} participant(s).`);
      });
    });

    bot.action(/^announce_event:(\d+)$/, async (ctx) => {
      await this.safeReply(ctx, botContext, async () => {
        await this.assertAdmin(ctx, botContext);
        const sentCount = await this.announceEventToSubscribers(
          Number(ctx.match[1]),
          botContext,
        );
        await ctx.answerCbQuery();
        await ctx.reply(`Announcement sent to ${sentCount} user(s).`);
        await this.showHome(ctx, botContext);
      });
    });

    bot.action(/^skip_announce_event:(\d+)$/, async (ctx) => {
      await this.safeReply(ctx, botContext, async () => {
        await this.assertAdmin(ctx, botContext);
        await ctx.answerCbQuery();
        await ctx.reply('Announcement skipped.');
        await this.showHome(ctx, botContext);
      });
    });

    bot.on('text', async (ctx) =>
      this.safeReply(ctx, botContext, () => this.handleText(ctx, botContext)),
    );
  }

  private async replyEvents(ctx, botContext: BotContext) {
    const { membership } = await this.ensureMembership(ctx.from, botContext);
    const events = await this.eventsService.findAll(botContext.organization.id);
    if (!events.length) {
      await ctx.reply(
        botContext.settings.texts.noActiveEvents,
        this.mainMenu(botContext.settings, membership.role),
      );
      return;
    }

    for (const event of events) {
      await ctx.reply(
        this.formatEvent(event),
        this.eventButtons(event, botContext.settings),
      );
    }
  }

  private async replyMyBookings(ctx, botContext: BotContext) {
    const { user } = await this.ensureMembership(ctx.from, botContext);
    const bookings = await this.eventsService.myBookings(
      user.id,
      botContext.organization.id,
    );
    if (!bookings.length) {
      await ctx.reply('You have no confirmed bookings.', this.userMenu(botContext.settings));
      return;
    }

    for (const booking of bookings) {
      await ctx.reply(
        this.formatBooking(booking),
        Markup.inlineKeyboard([
          Markup.button.callback('Cancel booking', `cancel:${booking.event.id}`),
        ]),
      );
    }
  }

  private async replyMyWaitlist(ctx, botContext: BotContext) {
    const { user } = await this.ensureMembership(ctx.from, botContext);
    const items = await this.eventsService.myWaitlist(
      user.id,
      botContext.organization.id,
    );
    if (!items.length) {
      await ctx.reply('Your waitlist is empty.', this.userMenu(botContext.settings));
      return;
    }

    await ctx.reply(
      items
        .map((item) => `${item.event.title}: ${item.status}, position ${item.position}`)
        .join('\n'),
    );
  }

  private async replyAdmin(ctx, botContext: BotContext) {
    const { membership } = await this.ensureMembership(ctx.from, botContext);
    if (!this.isAdmin(membership.role)) {
      await ctx.reply('Admin only.');
      return;
    }

    const menu = botContext.settings.menu;
    await ctx.reply(
      'Admin menu',
      this.adminMenu(botContext.settings),
    );
  }

  private async replyAdminEvents(ctx, botContext: BotContext) {
    await this.assertAdmin(ctx, botContext);

    const events = await this.eventsService.findAll(botContext.organization.id);
    if (!events.length) {
      await ctx.reply(botContext.settings.texts.noActiveEvents);
      return;
    }

    for (const event of events) {
      await ctx.reply(
        this.formatAdminEvent(event),
        Markup.inlineKeyboard([
          [
            Markup.button.callback('Participants', `admin_participants:${event.id}`),
            Markup.button.callback('Waitlist', `admin_waitlist:${event.id}`),
          ],
          [
            Markup.button.callback('Cancel event', `admin_cancel:${event.id}`),
            Markup.button.callback('Send reminder', `admin_reminder:${event.id}`),
          ],
        ]),
      );
    }
  }

  private async startCreateEvent(ctx, botContext: BotContext) {
    const { user, membership } = await this.ensureMembership(ctx.from, botContext);
    if (!this.isAdmin(membership.role)) {
      await ctx.reply('Admin only.');
      return;
    }

    this.adminDrafts.set(this.draftKey(botContext.organization.id, user.id), {
      organizationId: botContext.organization.id,
      userId: user.id,
      step: 'title',
      data: {},
    });
    await ctx.reply('Enter event title');
  }

  private async handleText(ctx, botContext: BotContext) {
    const { user } = await this.ensureMembership(ctx.from, botContext);
    const draft = this.adminDrafts.get(this.draftKey(botContext.organization.id, user.id));
    if (!draft) {
      return;
    }

    const text = ctx.message.text.trim();

    if (draft.step === 'title') {
      draft.data.title = text;
      draft.step = 'description';
      await ctx.reply('Enter description');
      return;
    }
    if (draft.step === 'description') {
      draft.data.description = text || null;
      draft.step = 'startsAt';
      await ctx.reply('Enter date/time, example: 2026-05-10 18:30');
      return;
    }
    if (draft.step === 'startsAt') {
      if (!this.isValidDateInput(text)) {
        await ctx.reply('Invalid date/time. Use format like 2026-05-10 18:30');
        return;
      }
      draft.data.startsAt = text;
      draft.step = 'capacity';
      await ctx.reply('Enter capacity');
      return;
    }
    if (draft.step === 'capacity') {
      const capacity = Number(text);
      if (!Number.isInteger(capacity) || capacity < 1) {
        await ctx.reply('Capacity must be a positive number');
        return;
      }
      draft.data.capacity = capacity;
      draft.step = 'teacher';
      await ctx.reply('Enter host');
      return;
    }
    if (draft.step === 'teacher') {
      draft.data.teacher = text;
      draft.step = 'locationOrZoomLink';
      await ctx.reply('Enter location or Zoom link');
      return;
    }

    draft.data.locationOrZoomLink = text;
    const event = await this.eventsService.create({
      organizationId: botContext.organization.id,
      title: draft.data.title!,
      description: draft.data.description ?? null,
      startsAt: draft.data.startsAt!,
      capacity: draft.data.capacity!,
      level: 'General',
      teacher: draft.data.teacher!,
      locationOrZoomLink: draft.data.locationOrZoomLink!,
    });
    this.adminDrafts.delete(this.draftKey(botContext.organization.id, user.id));
    await ctx.reply(`Event created: ${event.title}`);
    await this.afterEventCreated(ctx, event, botContext);
  }

  private async afterEventCreated(ctx, event: Event, botContext: BotContext) {
    const settings = botContext.settings;
    if (
      !settings.features.eventAnnouncements ||
      settings.eventAnnouncementMode === EventAnnouncementMode.Off
    ) {
      await this.showHome(ctx, botContext);
      return;
    }

    if (settings.eventAnnouncementMode === EventAnnouncementMode.Auto) {
      const sentCount = await this.announceEventToSubscribers(event.id, botContext);
      await ctx.reply(`Announcement sent to ${sentCount} user(s).`);
      await this.showHome(ctx, botContext);
      return;
    }

    await ctx.reply(
      'Notify users about this event?',
      Markup.inlineKeyboard([
        [
          Markup.button.callback('Send announcement', `announce_event:${event.id}`),
          Markup.button.callback('Skip', `skip_announce_event:${event.id}`),
        ],
      ]),
    );
  }

  private async announceEventToSubscribers(
    eventId: number,
    botContext: BotContext,
  ): Promise<number> {
    const event = await this.eventsService.findOne(eventId, botContext.organization.id);
    const telegramIds = await this.organizationsService.listSubscriberTelegramIds(
      botContext.organization.id,
    );

    await this.announceNewEvent(
      telegramIds,
      event,
      botContext.organization.id,
    );

    return new Set(telegramIds).size;
  }

  private async showHome(ctx, botContext: BotContext) {
    const { user, membership } = await this.ensureMembership(ctx.from, botContext);
    await ctx.reply(
      `${botContext.settings.texts.welcome}, ${user.firstName ?? 'there'}.`,
      this.mainMenu(botContext.settings, membership.role),
    );
  }

  private async ensureMembership(from, botContext: BotContext) {
    const user = await this.usersService.upsertTelegramUser({
      telegramId: String(from.id),
      firstName: from.first_name ?? null,
      username: from.username ?? null,
    });
    const membership = await this.organizationsService.findOrCreateMembership(
      botContext.organization,
      user,
    );

    return { user, membership };
  }

  private async assertAdmin(ctx, botContext: BotContext) {
    const { membership } = await this.ensureMembership(ctx.from, botContext);
    if (!this.isAdmin(membership.role)) {
      await ctx.answerCbQuery?.('Admin only');
      throw new Error('Admin only');
    }
  }

  private mainMenu(settings: BotSettings, role: OrganizationUserRole) {
    const menu = settings.menu;
    const rows = [
      [menu.eventsLabel],
      [menu.bookingsLabel, menu.waitlistLabel],
    ];
    if (this.isAdmin(role)) {
      rows.push([menu.adminLabel]);
    }
    return Markup.keyboard(rows).resize();
  }

  private userMenu(settings: BotSettings) {
    const menu = settings.menu;
    return Markup.keyboard([
      [menu.eventsLabel],
      [menu.bookingsLabel, menu.waitlistLabel],
      [menu.homeLabel],
    ]).resize();
  }

  private adminMenu(settings: BotSettings) {
    const menu = settings.menu;
    return Markup.keyboard([
      [menu.createEventLabel, menu.myEventsLabel],
      [menu.eventsLabel],
      [menu.homeLabel],
    ]).resize();
  }

  private isAdmin(role: OrganizationUserRole) {
    return role === OrganizationUserRole.Admin;
  }

  private eventButtons(event: EventListItem, settings: BotSettings) {
    const hasPlaces = event.confirmedCount < event.capacity;
    const action = hasPlaces || !settings.features.waitlist ? 'join' : 'wait';
    return Markup.inlineKeyboard([
      Markup.button.callback(
        hasPlaces ? 'Join' : settings.features.waitlist ? 'Join waitlist' : 'Join',
        `${action}:${event.id}`,
      ),
    ]);
  }

  private formatEvent(event: EventListItem) {
    return [
      event.title,
      new Date(event.startsAt).toLocaleString(),
      `Host: ${event.teacher}`,
      `Places: ${event.confirmedCount}/${event.capacity}`,
      event.description,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private formatNewEventAnnouncement(event: Event) {
    return [
      `New event: ${event.title}`,
      new Date(event.startsAt).toLocaleString(),
      `Host: ${event.teacher}`,
      `Places: ${event.capacity}`,
      event.locationOrZoomLink,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private formatBooking(booking: Participant) {
    return [
      booking.event.title,
      new Date(booking.event.startsAt).toLocaleString(),
      `Host: ${booking.event.teacher}`,
      booking.event.locationOrZoomLink,
    ].join('\n');
  }

  private formatAdminEvent(event: EventListItem) {
    return [
      event.title,
      new Date(event.startsAt).toLocaleString(),
      `Capacity: ${event.capacity}`,
      `Confirmed: ${event.confirmedCount}`,
      `Waitlist: ${event.waitlistCount}`,
      `Status: ${event.status}`,
    ].join('\n');
  }

  private formatUserLine(user: User) {
    const username = user.username ? `@${user.username}` : 'no username';
    return `${user.firstName ?? 'User'} (${username})`;
  }

  private draftKey(organizationId: number, userId: number) {
    return `${organizationId}:${userId}`;
  }

  private isValidDateInput(value: string) {
    return !Number.isNaN(new Date(value).getTime());
  }

  private async safeReply(
    ctx,
    botContext: BotContext,
    handler: () => Promise<void>,
  ) {
    try {
      await handler();
    } catch (error) {
      if (error instanceof BadRequestException) {
        await ctx.reply(error.message);
        return;
      }

      this.logger.error(error);
      await this.logsService.logError({
        organizationId: botContext.organization.id,
        source: TelegramBotService.name,
        error,
        context: this.buildLogContext(ctx),
      });
      await ctx.reply('Something went wrong. Please try again.');
    }
  }

  private buildLogContext(ctx) {
    return {
      updateId: ctx.update?.update_id ?? null,
      messageText: ctx.message?.text ?? null,
      callbackData: ctx.callbackQuery?.data ?? null,
      telegramUserId: ctx.from?.id ? String(ctx.from.id) : null,
      telegramUsername: ctx.from?.username ?? null,
      chatId: ctx.chat?.id ? String(ctx.chat.id) : null,
    };
  }
}
