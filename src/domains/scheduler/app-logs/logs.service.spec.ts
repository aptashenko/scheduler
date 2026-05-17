import { AppLogLevel } from './entities/app-log.entity';
import { LogsService } from './logs.service';

describe('LogsService', () => {
  let service: LogsService;
  let logsRepository;

  beforeEach(() => {
    logsRepository = {
      create: jest.fn((input) => input),
      save: jest.fn(async (input) => ({ id: 1, ...input })),
      find: jest.fn(),
    };
    service = new LogsService(logsRepository);
  });

  it('creates an organization-scoped log', async () => {
    await service.create({
      organizationId: 7,
      level: AppLogLevel.Error,
      source: 'TelegramBotService',
      message: 'Boom',
      context: { updateId: 1 },
    });

    expect(logsRepository.create).toHaveBeenCalledWith({
      organization: { id: 7 },
      level: AppLogLevel.Error,
      source: 'TelegramBotService',
      message: 'Boom',
      stack: null,
      context: { updateId: 1 },
    });
  });

  it('normalizes Error objects in logError', async () => {
    const error = new Error('Failure');

    await service.logError({
      organizationId: 7,
      source: 'TelegramBotService',
      error,
      context: { telegramUserId: '123' },
    });

    expect(logsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organization: { id: 7 },
        level: AppLogLevel.Error,
        message: 'Failure',
        stack: expect.stringContaining('Error: Failure'),
        context: { telegramUserId: '123' },
      }),
    );
  });

  it('limits organization logs between 1 and 500', async () => {
    await service.findByOrganization(7, 999);

    expect(logsRepository.find).toHaveBeenCalledWith({
      where: { organization: { id: 7 } },
      order: { createdAt: 'DESC' },
      take: 500,
    });
  });
});
