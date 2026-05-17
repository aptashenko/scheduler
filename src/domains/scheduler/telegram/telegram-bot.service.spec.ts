const telegrafInstances: any[] = [];

jest.mock('telegraf', () => {
  class MockTelegraf {
    telegram = {
      sendMessage: jest.fn(),
      setWebhook: jest.fn(),
    };
    launch = jest.fn();
    stop = jest.fn();
    handleUpdate = jest.fn();
    start = jest.fn();
    command = jest.fn();
    hears = jest.fn();
    action = jest.fn();
    on = jest.fn();

    constructor(public readonly token: string) {
      telegrafInstances.push(this);
    }
  }

  return {
    Telegraf: MockTelegraf,
    Markup: {
      keyboard: jest.fn((rows) => ({
        type: 'keyboard',
        rows,
        resize: jest.fn().mockReturnValue({ type: 'keyboard', rows, resize: true }),
      })),
      inlineKeyboard: jest.fn((buttons) => ({ type: 'inlineKeyboard', buttons })),
      button: {
        callback: jest.fn((text, data) => ({ text, callback_data: data })),
      },
    },
  };
});

import { defaultBotSettings } from '../organizations/entities/organization.entity';
import { OrganizationUserRole } from '../organizations/entities/organization-user.entity';
import { EventStatus } from '../events/entities/event.entity';
import { ParticipantStatus } from '../participants/entities/participant.entity';
import { WaitlistStatus } from '../waitlist/entities/waitlist.entity';
import { TelegramBotService } from './telegram-bot.service';

describe('TelegramBotService', () => {
  let service: TelegramBotService;
  let usersService;
  let organizationsService;
  let logsService;
  let eventsService;
  let organization;
  let user;
  let membership;

  beforeEach(() => {
    telegrafInstances.length = 0;

    organization = {
      id: 7,
      name: 'Yoga Club',
      botToken: 'bot-token-7',
      settings: {
        ...defaultBotSettings,
        menu: {
          ...defaultBotSettings.menu,
          eventsLabel: 'Classes',
          bookingsLabel: 'My classes',
          waitlistLabel: 'Queue',
          adminLabel: 'Admin',
          createEventLabel: 'Create class',
          myEventsLabel: 'Manage classes',
          backLabel: 'Back',
          homeLabel: 'Home',
        },
        texts: {
          ...defaultBotSettings.texts,
          welcome: 'Welcome to Yoga Club',
          confirmed: 'Booked',
          waitlistJoined: 'Joined queue',
          noActiveEvents: 'No classes',
        },
      },
    };
    user = {
      id: 5,
      telegramId: '123',
      firstName: 'Alex',
      username: 'alex',
    };
    membership = {
      id: 10,
      user,
      organization,
      role: OrganizationUserRole.User,
    };
    usersService = {
      upsertTelegramUser: jest.fn(async () => user),
    };
    organizationsService = {
      findOrCreateDefault: jest.fn(),
      findOneOrFail: jest.fn(async () => organization),
      findOrCreateMembership: jest.fn(async () => membership),
      listSubscriberTelegramIds: jest.fn(async () => ['123', '456']),
    };
    logsService = {
      logError: jest.fn(),
    };
    eventsService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      myBookings: jest.fn(),
      myWaitlist: jest.fn(),
      joinEvent: jest.fn(),
      joinWaitlist: jest.fn(),
      cancelBooking: jest.fn(),
      acceptWaitlistInvite: jest.fn(),
      declineWaitlistInvite: jest.fn(),
      listParticipants: jest.fn(),
      listWaitlist: jest.fn(),
      cancelEvent: jest.fn(),
      sendReminder: jest.fn(),
      create: jest.fn(),
    };

    service = new TelegramBotService(
      usersService,
      organizationsService,
      logsService,
      eventsService,
    );
  });

  function ctx(overrides: Record<string, unknown> = {}) {
    return {
      from: {
        id: 123,
        first_name: 'Alex',
        username: 'alex',
      },
      message: {
        text: '',
      },
      reply: jest.fn(),
      answerCbQuery: jest.fn(),
      match: [],
      ...overrides,
    };
  }

  it('sets webhook URL for the requested organization bot', async () => {
    const url = await service.setWebhook(7, 'https://example.com/');

    expect(url).toBe('https://example.com/scheduler/telegram/webhook/7');
    expect(telegrafInstances).toHaveLength(1);
    expect(telegrafInstances[0].token).toBe('bot-token-7');
    expect(telegrafInstances[0].telegram.setWebhook).toHaveBeenCalledWith(
      'https://example.com/scheduler/telegram/webhook/7',
    );
  });

  it('handles webhook updates through the organization-specific bot', async () => {
    const update = { update_id: 1, message: { text: '/start' } };

    await service.handleWebhook(7, update);

    expect(organizationsService.findOneOrFail).toHaveBeenCalledWith(7);
    expect(telegrafInstances[0].handleUpdate).toHaveBeenCalledWith(update);
  });

  it('shows organization scoped events using custom settings labels', async () => {
    eventsService.findAll.mockResolvedValue([
      {
        id: 11,
        title: 'Morning Yoga',
        startsAt: new Date('2026-05-10T10:00:00Z'),
        level: 'beginner',
        teacher: 'Anna',
        description: 'Mat class',
        capacity: 2,
        status: EventStatus.Active,
        confirmedCount: 1,
        waitlistCount: 0,
      },
    ]);
    const replyCtx = ctx();

    await (service as any).replyEvents(replyCtx, {
      organization,
      settings: organization.settings,
    });

    expect(eventsService.findAll).toHaveBeenCalledWith(7);
    expect(replyCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Morning Yoga'),
      expect.objectContaining({ type: 'inlineKeyboard' }),
    );
  });

  it('shows home menu with custom labels and admin entry for admins', async () => {
    membership.role = OrganizationUserRole.Admin;
    const replyCtx = ctx();

    await (service as any).showHome(replyCtx, {
      organization,
      settings: organization.settings,
    });

    expect(replyCtx.reply).toHaveBeenCalledWith(
      'Welcome to Yoga Club, Alex.',
      expect.objectContaining({
        type: 'keyboard',
        rows: [
          ['Classes'],
          ['My classes', 'Queue'],
          ['Admin'],
        ],
        resize: true,
      }),
    );
  });

  it('uses organizationId when joining an event from a callback', async () => {
    eventsService.joinEvent.mockResolvedValue({
      status: 'CONFIRMED',
      event: { id: 11, title: 'Morning Yoga' },
    });
    const callbackCtx = ctx({ match: ['join:11', '11'] });
    const handlerPromises: Promise<unknown>[] = [];

    await (service as any).registerHandlers(
      {
        start: jest.fn(),
        command: jest.fn(),
        hears: jest.fn(),
        on: jest.fn(),
        action: jest.fn((pattern, handler) => {
          if (String(pattern) === String(/^join:(\d+)$/)) {
            const promise = handler(callbackCtx);
            handlerPromises.push(promise);
            return promise;
          }
          return undefined;
        }),
      },
      { organization, settings: organization.settings },
    );
    await Promise.all(handlerPromises);

    expect(eventsService.joinEvent).toHaveBeenCalledWith(5, 11, 7);
    expect(callbackCtx.answerCbQuery).toHaveBeenCalled();
    expect(callbackCtx.reply).toHaveBeenCalledWith('Booked: Morning Yoga');
  });

  it('creates event for current organization during admin create flow', async () => {
    membership.role = OrganizationUserRole.Admin;
    eventsService.create.mockResolvedValue({ id: 44, title: 'New Class' });
    const botContext = { organization, settings: organization.settings };
    const createCtx = ctx();

    await (service as any).startCreateEvent(createCtx, botContext);
    await (service as any).handleText(
      ctx({ message: { text: 'New Class' } }),
      botContext,
    );
    await (service as any).handleText(
      ctx({ message: { text: 'Description' } }),
      botContext,
    );
    await (service as any).handleText(
      ctx({ message: { text: '2026-05-10 18:30' } }),
      botContext,
    );
    await (service as any).handleText(ctx({ message: { text: '12' } }), botContext);
    await (service as any).handleText(ctx({ message: { text: 'Anna' } }), botContext);
    const finalCtx = ctx({ message: { text: 'Zoom' } });
    await (service as any).handleText(finalCtx, botContext);

    expect(eventsService.create).toHaveBeenCalledWith({
      organizationId: 7,
      title: 'New Class',
      description: 'Description',
      startsAt: '2026-05-10 18:30',
      capacity: 12,
      level: 'General',
      teacher: 'Anna',
      locationOrZoomLink: 'Zoom',
    });
    expect(finalCtx.reply).toHaveBeenCalledWith('Event created: New Class');
    expect(finalCtx.reply).toHaveBeenCalledWith(
      'Notify users about this event?',
      expect.objectContaining({ type: 'inlineKeyboard' }),
    );
  });

  it('announces created event to organization subscribers when admin confirms', async () => {
    membership.role = OrganizationUserRole.Admin;
    eventsService.findOne.mockResolvedValue({
      id: 44,
      title: 'New Class',
      startsAt: new Date('2026-05-10T10:00:00Z'),
      level: 'beginner',
      teacher: 'Anna',
      capacity: 12,
      locationOrZoomLink: 'Zoom',
    });
    const callbackCtx = ctx({ match: ['announce_event:44', '44'] });

    await (service as any).registerHandlers(
      {
        start: jest.fn(),
        command: jest.fn(),
        hears: jest.fn(),
        on: jest.fn(),
        action: jest.fn((pattern, handler) => {
          if (String(pattern) === String(/^announce_event:(\d+)$/)) {
            return handler(callbackCtx);
          }
          return undefined;
        }),
      },
      { organization, settings: organization.settings },
    );

    await new Promise(process.nextTick);

    expect(organizationsService.listSubscriberTelegramIds).toHaveBeenCalledWith(7);
    expect(telegrafInstances[0].telegram.sendMessage).toHaveBeenCalledWith(
      '123',
      expect.stringContaining('New event: New Class'),
      expect.objectContaining({ type: 'inlineKeyboard' }),
    );
    expect(callbackCtx.reply).toHaveBeenCalledWith('Announcement sent to 2 user(s).');
  });

  it('keeps admin create flow on date step when date is invalid', async () => {
    membership.role = OrganizationUserRole.Admin;
    const botContext = { organization, settings: organization.settings };

    await (service as any).startCreateEvent(ctx(), botContext);
    await (service as any).handleText(
      ctx({ message: { text: 'New Class' } }),
      botContext,
    );
    await (service as any).handleText(
      ctx({ message: { text: 'Description' } }),
      botContext,
    );
    const invalidDateCtx = ctx({ message: { text: 'sda' } });

    await (service as any).handleText(invalidDateCtx, botContext);

    expect(eventsService.create).not.toHaveBeenCalled();
    expect(invalidDateCtx.reply).toHaveBeenCalledWith(
      'Invalid date/time. Use format like 2026-05-10 18:30',
    );
  });

  it('sends waitlist invite through the event organization bot', async () => {
    await service.sendWaitlistInvite({
      id: 50,
      status: WaitlistStatus.Invited,
      position: 1,
      event: {
        id: 11,
        title: 'Morning Yoga',
        organization,
      },
      user: {
        telegramId: '123',
      },
    } as never);

    expect(telegrafInstances[0].token).toBe('bot-token-7');
    expect(telegrafInstances[0].telegram.sendMessage).toHaveBeenCalledWith(
      '123',
      'A spot is available for "Morning Yoga". Do you want to join?',
      expect.objectContaining({ type: 'inlineKeyboard' }),
    );
  });

  it('shows current organization bookings only', async () => {
    eventsService.myBookings.mockResolvedValue([
      {
        id: 1,
        status: ParticipantStatus.Confirmed,
        event: {
          id: 11,
          title: 'Morning Yoga',
          startsAt: new Date('2026-05-10T10:00:00Z'),
          teacher: 'Anna',
          locationOrZoomLink: 'Zoom',
        },
      },
    ]);
    const replyCtx = ctx();

    await (service as any).replyMyBookings(replyCtx, {
      organization,
      settings: organization.settings,
    });

    expect(eventsService.myBookings).toHaveBeenCalledWith(5, 7);
    expect(replyCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Morning Yoga'),
      expect.objectContaining({ type: 'inlineKeyboard' }),
    );
  });

  it('writes unexpected telegram handler errors to organization logs', async () => {
    const error = new Error('Handler failed');
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    const replyCtx = ctx({
      update: { update_id: 99 },
      message: { text: 'Classes' },
      chat: { id: 123 },
    });

    await (service as any).safeReply(
      replyCtx,
      { organization, settings: organization.settings },
      async () => {
        throw error;
      },
    );

    expect(logsService.logError).toHaveBeenCalledWith({
      organizationId: 7,
      source: 'TelegramBotService',
      error,
      context: expect.objectContaining({
        updateId: 99,
        messageText: 'Classes',
        telegramUserId: '123',
        telegramUsername: 'alex',
        chatId: '123',
      }),
    });
    expect(replyCtx.reply).toHaveBeenCalledWith('Something went wrong. Please try again.');
  });
});
