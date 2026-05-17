import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Event, EventStatus } from './entities/event.entity';
import { EventsService } from './events.service';
import {
  Participant,
  ParticipantStatus,
} from '../participants/entities/participant.entity';
import { Waitlist, WaitlistStatus } from '../waitlist/entities/waitlist.entity';

describe('EventsService', () => {
  let service: EventsService;
  let eventsRepository;
  let participantsRepository;
  let waitlistRepository;
  let notificationsService;

  beforeEach(() => {
    eventsRepository = {
      create: jest.fn((input) => input),
      save: jest.fn(async (input) => ({ id: 1, ...input })),
      find: jest.fn(),
      findOne: jest.fn(),
      manager: {
        transaction: jest.fn((callback) => callback(eventsRepository.manager)),
        findOne: jest.fn(),
        count: jest.fn(),
        create: jest.fn((_, input) => input),
        save: jest.fn(async (input) => ({ id: 100, ...input })),
      },
    };
    participantsRepository = {
      count: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(async (input) => input),
    };
    waitlistRepository = {
      count: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(async (input) => input),
    };
    notificationsService = {
      sendWaitlistInvite: jest.fn(),
      notifyUsers: jest.fn(),
    };

    service = new EventsService(
      eventsRepository,
      participantsRepository,
      waitlistRepository,
      notificationsService,
    );
  });

  it('creates an active event scoped to an organization', async () => {
    const event = await service.create({
      organizationId: 7,
      title: 'Yoga',
      description: null,
      startsAt: '2026-05-10 18:30',
      capacity: 10,
      level: 'beginner',
      teacher: 'Anna',
      locationOrZoomLink: 'Zoom',
    });

    expect(eventsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organization: { id: 7 },
        status: EventStatus.Active,
        title: 'Yoga',
      }),
    );
    expect(event.organization).toEqual({ id: 7 });
  });

  it('rejects creating an event without organizationId', async () => {
    expect(() =>
      service.create({
        title: 'Yoga',
        startsAt: '2026-05-10 18:30',
        capacity: 10,
        level: 'beginner',
        teacher: 'Anna',
        locationOrZoomLink: 'Zoom',
      }),
    ).toThrow(BadRequestException);
  });

  it('lists only active events for the requested organization and adds counts', async () => {
    eventsRepository.find.mockResolvedValue([{ id: 11, title: 'Yoga' }]);
    participantsRepository.count.mockResolvedValue(3);
    waitlistRepository.count.mockResolvedValue(2);

    const events = await service.findAll(7);

    expect(eventsRepository.find).toHaveBeenCalledWith({
      where: {
        status: EventStatus.Active,
        organization: { id: 7 },
      },
      order: { startsAt: 'ASC' },
    });
    expect(events).toEqual([
      expect.objectContaining({
        id: 11,
        confirmedCount: 3,
        waitlistCount: 2,
      }),
    ]);
  });

  it('confirms a user immediately when capacity is available', async () => {
    const event = { id: 10, capacity: 2 };
    eventsRepository.manager.findOne.mockImplementation((entity) => {
      if (entity === Event) return Promise.resolve(event);
      return Promise.resolve(null);
    });
    eventsRepository.manager.count.mockResolvedValue(1);

    const result = await service.joinEvent(5, 10, 7);

    expect(eventsRepository.manager.findOne).toHaveBeenCalledWith(Event, {
      where: {
        id: 10,
        status: EventStatus.Active,
        organization: { id: 7 },
      },
    });
    expect(eventsRepository.manager.create).toHaveBeenCalledWith(Participant, {
      event: { id: 10 },
      user: { id: 5 },
      status: ParticipantStatus.Confirmed,
    });
    expect(result.status).toBe('CONFIRMED');
  });

  it('adds the user to waitlist when event is full', async () => {
    const waitlistFindResults = [null, { position: 3 }];
    eventsRepository.manager.findOne.mockImplementation((entity) => {
      if (entity === Event) return Promise.resolve({ id: 10, capacity: 2 });
      if (entity === Waitlist) return Promise.resolve(waitlistFindResults.shift());
      return Promise.resolve(null);
    });
    eventsRepository.manager.count.mockResolvedValue(2);

    const result = await service.joinEvent(5, 10, 7);

    expect(eventsRepository.manager.create).toHaveBeenCalledWith(Waitlist, {
      event: { id: 10 },
      user: { id: 5 },
      status: WaitlistStatus.Waiting,
      position: 4,
      invitedAt: null,
      expiresAt: null,
    });
    expect(result.status).toBe('WAITING');
  });

  it('blocks duplicate confirmed bookings', async () => {
    eventsRepository.manager.findOne.mockImplementation((entity) => {
      if (entity === Event) return Promise.resolve({ id: 10, capacity: 2 });
      if (entity === Participant) return Promise.resolve({ id: 99 });
      return Promise.resolve(null);
    });

    await expect(service.joinEvent(5, 10, 7)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('invites the first waiting user and uses organization invite timeout', async () => {
    eventsRepository.findOne.mockResolvedValue({
      id: 10,
      capacity: 2,
      organization: {
        id: 7,
        settings: { inviteTimeoutMinutes: 30 },
      },
    });
    participantsRepository.count.mockResolvedValue(1);
    waitlistRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 50,
        status: WaitlistStatus.Waiting,
        event: { id: 10, organization: { id: 7 } },
        user: { id: 5, telegramId: '123' },
      });

    const before = Date.now();
    const result = await service.inviteNextFromWaitlist(10, 7);

    expect(result.invited).toBe(true);
    if (result.invited) {
      expect(result.waitlist.status).toBe(WaitlistStatus.Invited);
      expect(result.waitlist.expiresAt!.getTime()).toBeGreaterThanOrEqual(
        before + 30 * 60 * 1000,
      );
    }
  });

  it('cancels a booking and sends invite to the next waitlist user', async () => {
    participantsRepository.findOne.mockResolvedValue({
      id: 1,
      status: ParticipantStatus.Confirmed,
      event: { id: 10 },
    });
    jest.spyOn(service, 'inviteNextFromWaitlist').mockResolvedValue({
      invited: true,
      waitlist: {
        id: 2,
        event: { id: 10, organization: { id: 7 } },
        user: { telegramId: '123' },
      } as Waitlist,
    });

    await service.cancelBooking(5, 10, 7);

    expect(participantsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ParticipantStatus.Cancelled }),
    );
    expect(service.inviteNextFromWaitlist).toHaveBeenCalledWith(10, 7);
    expect(notificationsService.sendWaitlistInvite).toHaveBeenCalled();
  });

  it('accepts an active waitlist invite when a place is still available', async () => {
    eventsRepository.manager.findOne.mockResolvedValue({
      id: 50,
      status: WaitlistStatus.Invited,
      expiresAt: new Date(Date.now() + 60_000),
      event: { id: 10, capacity: 2 },
      user: { id: 5 },
    });
    eventsRepository.manager.count.mockResolvedValue(1);

    const result = await service.acceptWaitlistInvite(5, 10, 7);

    expect(eventsRepository.manager.findOne).toHaveBeenCalledWith(Waitlist, {
      where: {
        event: { id: 10, organization: { id: 7 } },
        user: { id: 5 },
        status: WaitlistStatus.Invited,
      },
      relations: { event: true, user: true },
    });
    expect(eventsRepository.manager.create).toHaveBeenCalledWith(Participant, {
      event: { id: 10 },
      user: { id: 5 },
      status: ParticipantStatus.Confirmed,
    });
    expect(result.accepted).toBe(true);
  });

  it('expires old invites and invites next user for the same organization', async () => {
    waitlistRepository.find.mockResolvedValue([
      {
        id: 50,
        status: WaitlistStatus.Invited,
        event: { id: 10, organization: { id: 7 } },
      },
    ]);
    jest.spyOn(service, 'inviteNextFromWaitlist').mockResolvedValue({
      invited: false,
      reason: 'NO_WAITING_USERS',
    });

    const count = await service.expireOldInvites();

    expect(count).toBe(1);
    expect(waitlistRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: WaitlistStatus.Expired }),
    );
    expect(service.inviteNextFromWaitlist).toHaveBeenCalledWith(10, 7);
  });

  it('throws when an event does not belong to the requested organization', async () => {
    eventsRepository.findOne.mockResolvedValue(null);

    await expect(service.findOne(10, 7)).rejects.toBeInstanceOf(NotFoundException);
    expect(eventsRepository.findOne).toHaveBeenCalledWith({
      where: { id: 10, organization: { id: 7 } },
      relations: { organization: true },
    });
  });
});
