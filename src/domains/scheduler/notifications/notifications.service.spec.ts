import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let telegramBotService;

  beforeEach(() => {
    telegramBotService = {
      sendWaitlistInvite: jest.fn(),
      notifyUsers: jest.fn(),
      announceNewEvent: jest.fn(),
    };
    service = new NotificationsService(telegramBotService);
  });

  it('delegates waitlist invite to the current Telegram adapter', async () => {
    const waitlist = { id: 1 };

    await service.sendWaitlistInvite(waitlist as never);

    expect(telegramBotService.sendWaitlistInvite).toHaveBeenCalledWith(waitlist);
  });

  it('delegates user notifications to the current Telegram adapter', async () => {
    await service.notifyUsers(['123', '456'], 'Message', 7);

    expect(telegramBotService.notifyUsers).toHaveBeenCalledWith(
      ['123', '456'],
      'Message',
      7,
    );
  });

  it('delegates new event announcements to the current Telegram adapter', async () => {
    const event = { id: 1 };

    await service.announceNewEvent(['123'], event as never, 7);

    expect(telegramBotService.announceNewEvent).toHaveBeenCalledWith(
      ['123'],
      event,
      7,
    );
  });
});
