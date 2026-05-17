import { OrganizationsService } from './organizations.service';
import { OrganizationUserRole } from './entities/organization-user.entity';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let organizationsRepository;
  let organizationUsersRepository;

  beforeEach(() => {
    process.env.TELEGRAM_ADMIN_IDS = '111,222';
    organizationsRepository = {
      findOneBy: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((input) => input),
      save: jest.fn(async (input) => ({ id: 1, ...input })),
    };
    organizationUsersRepository = {
      findOne: jest.fn(),
      create: jest.fn((input) => input),
      save: jest.fn(async (input) => ({ id: 10, ...input })),
    };

    service = new OrganizationsService(
      organizationsRepository,
      organizationUsersRepository,
    );
  });

  afterEach(() => {
    delete process.env.TELEGRAM_ADMIN_IDS;
  });

  it('creates an organization with default settings merged with overrides', async () => {
    const organization = await service.create({
      name: 'Yoga Club',
      slug: 'yoga',
      botToken: 'token',
      settings: {
        menu: { eventsLabel: 'Classes' },
        texts: { welcome: 'Welcome to Yoga' },
      } as never,
    });

    expect(organizationsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Yoga Club',
        slug: 'yoga',
        botToken: 'token',
        settings: expect.objectContaining({
          menu: expect.objectContaining({
            eventsLabel: 'Classes',
            bookingsLabel: 'My bookings',
          }),
          texts: expect.objectContaining({
            welcome: 'Welcome to Yoga',
            confirmed: 'Booking confirmed',
          }),
        }),
      }),
    );
    expect(organization.settings.menu.eventsLabel).toBe('Classes');
  });

  it('creates default organization from TELEGRAM_BOT_TOKEN', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'default-token';
    organizationsRepository.findOneBy.mockResolvedValue(null);

    const organization = await service.findOrCreateDefault();

    expect(organizationsRepository.findOneBy).toHaveBeenCalledWith({
      botToken: 'default-token',
    });
    expect(organization?.botToken).toBe('default-token');
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('returns null default organization when TELEGRAM_BOT_TOKEN is missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;

    await expect(service.findOrCreateDefault()).resolves.toBeNull();
  });

  it('creates admin membership for configured telegram admin id', async () => {
    organizationUsersRepository.findOne.mockResolvedValue(null);

    const membership = await service.findOrCreateMembership(
      { id: 7 } as never,
      { id: 5, telegramId: '111' } as never,
    );

    expect(membership.role).toBe(OrganizationUserRole.Admin);
    expect(organizationUsersRepository.create).toHaveBeenCalledWith({
      organization: { id: 7 },
      user: { id: 5, telegramId: '111' },
      role: OrganizationUserRole.Admin,
    });
  });

  it('creates regular membership for non-admin telegram id', async () => {
    organizationUsersRepository.findOne.mockResolvedValue(null);

    const membership = await service.findOrCreateMembership(
      { id: 7 } as never,
      { id: 5, telegramId: '333' } as never,
    );

    expect(membership.role).toBe(OrganizationUserRole.User);
  });

  it('reuses existing organization membership', async () => {
    organizationUsersRepository.findOne.mockResolvedValue({
      id: 99,
      role: OrganizationUserRole.Admin,
    });

    const membership = await service.findOrCreateMembership(
      { id: 7 } as never,
      { id: 5, telegramId: '111' } as never,
    );

    expect(membership.id).toBe(99);
    expect(organizationUsersRepository.save).not.toHaveBeenCalled();
  });
});
