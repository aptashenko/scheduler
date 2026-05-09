import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThan, Repository } from 'typeorm';
import {
  Participant,
  ParticipantStatus,
} from '../participants/entities/participant.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Waitlist, WaitlistStatus } from '../waitlist/entities/waitlist.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { Event, EventStatus } from './entities/event.entity';

export type EventListItem = Event & {
  confirmedCount: number;
  waitlistCount: number;
};

export type InviteResult =
  | { invited: false; reason: 'NO_WAITING_USERS' | 'INVITE_ALREADY_ACTIVE' | 'NO_FREE_PLACE' }
  | { invited: true; waitlist: Waitlist };

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(Event)
    private readonly eventsRepository: Repository<Event>,
    @InjectRepository(Participant)
    private readonly participantsRepository: Repository<Participant>,
    @InjectRepository(Waitlist)
    private readonly waitlistRepository: Repository<Waitlist>,
    private readonly notificationsService: NotificationsService,
  ) {}

  create(createEventDto: CreateEventDto) {
    if (!createEventDto.organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    const { organizationId, ...eventData } = createEventDto;
    const startsAt = this.parseDate(createEventDto.startsAt);

    return this.eventsRepository.save(
      this.eventsRepository.create({
        ...eventData,
        startsAt,
        level: eventData.level ?? 'General',
        status: EventStatus.Active,
        organization: { id: organizationId },
      }),
    );
  }

  async findAll(organizationId?: number): Promise<EventListItem[]> {
    const events = await this.eventsRepository.find({
      where: {
        status: EventStatus.Active,
        ...(organizationId ? { organization: { id: organizationId } } : {}),
      },
      order: { startsAt: 'ASC' },
    });

    return Promise.all(
      events.map(async (event) => ({
        ...event,
        confirmedCount: await this.countConfirmed(event.id),
        waitlistCount: await this.countWaiting(event.id),
      })),
    );
  }

  async findOne(id: number, organizationId?: number) {
    const event = await this.eventsRepository.findOne({
      where: {
        id,
        ...(organizationId ? { organization: { id: organizationId } } : {}),
      },
      relations: { organization: true },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  async update(id: number, updateEventDto: UpdateEventDto) {
    const event = await this.findOne(id, updateEventDto.organizationId);
    Object.assign(event, updateEventDto);
    if (updateEventDto.startsAt) {
      event.startsAt = this.parseDate(updateEventDto.startsAt);
    }
    return this.eventsRepository.save(event);
  }

  async remove(id: number) {
    return this.cancelEvent(id);
  }

  async cancelEvent(eventId: number, organizationId?: number) {
    const event = await this.findOne(eventId, organizationId);
    event.status = EventStatus.Cancelled;
    await this.eventsRepository.save(event);

    const participants = await this.participantsRepository.find({
      where: {
        event: { id: eventId },
        status: ParticipantStatus.Confirmed,
      },
      relations: { user: true },
    });
    const waitlist = await this.waitlistRepository.find({
      where: [
        { event: { id: eventId }, status: WaitlistStatus.Waiting },
        { event: { id: eventId }, status: WaitlistStatus.Invited },
      ],
      relations: { user: true },
    });

    await this.notificationsService.notifyUsers(
      [...participants, ...waitlist].map((item) => item.user.telegramId),
      `Event cancelled: ${event.title}`,
      event.organization.id,
    );

    return event;
  }

  async sendReminder(eventId: number, organizationId?: number) {
    const event = await this.findOne(eventId, organizationId);
    const participants = await this.participantsRepository.find({
      where: {
        event: { id: eventId },
        status: ParticipantStatus.Confirmed,
      },
      relations: { user: true },
    });

    await this.notificationsService.notifyUsers(
      participants.map((participant) => participant.user.telegramId),
      `Reminder: ${event.title}\n${new Date(event.startsAt).toLocaleString()}\n${event.locationOrZoomLink}`,
      event.organization.id,
    );

    return participants.length;
  }

  async joinEvent(userId: number, eventId: number, organizationId: number) {
    const result = await this.eventsRepository.manager.transaction(async (manager) => {
      const event = await manager.findOne(Event, {
        where: {
          id: eventId,
          status: EventStatus.Active,
          organization: { id: organizationId },
        },
      });
      if (!event) {
        throw new NotFoundException('Active event not found');
      }

      await this.assertUserCanJoin(manager, userId, eventId, organizationId);

      const confirmedCount = await manager.count(Participant, {
        where: {
          event: { id: eventId },
          status: ParticipantStatus.Confirmed,
        },
      });

      if (confirmedCount < event.capacity) {
        const participant = manager.create(Participant, {
          event: { id: eventId },
          user: { id: userId },
          status: ParticipantStatus.Confirmed,
        });
        return {
          status: 'CONFIRMED' as const,
          participant: await manager.save(participant),
          event,
        };
      }

      const waitlist = await this.createWaitingRecord(manager, userId, eventId);
      return { status: 'WAITING' as const, waitlist, event };
    });

    return result;
  }

  async joinWaitlist(userId: number, eventId: number, organizationId: number) {
    return this.eventsRepository.manager.transaction(async (manager) => {
      const event = await manager.findOne(Event, {
        where: {
          id: eventId,
          status: EventStatus.Active,
          organization: { id: organizationId },
        },
      });
      if (!event) {
        throw new NotFoundException('Active event not found');
      }

      await this.assertUserCanJoin(manager, userId, eventId, organizationId);
      return this.createWaitingRecord(manager, userId, eventId);
    });
  }

  async cancelBooking(userId: number, eventId: number, organizationId: number) {
    const participant = await this.participantsRepository.findOne({
      where: {
        event: { id: eventId, organization: { id: organizationId } },
        user: { id: userId },
        status: ParticipantStatus.Confirmed,
      },
      relations: { event: true },
    });

    if (!participant) {
      throw new NotFoundException('Confirmed booking not found');
    }

    participant.status = ParticipantStatus.Cancelled;
    await this.participantsRepository.save(participant);

    const invite = await this.inviteNextFromWaitlist(eventId, organizationId);
    await this.sendInviteIfNeeded(invite);

    return participant;
  }

  async inviteNextFromWaitlist(
    eventId: number,
    organizationId?: number,
  ): Promise<InviteResult> {
    const event = await this.findOne(eventId, organizationId);
    const inviteTimeoutMinutes =
      event.organization.settings?.inviteTimeoutMinutes ?? 15;
    const confirmedCount = await this.countConfirmed(eventId);
    if (confirmedCount >= event.capacity) {
      return { invited: false, reason: 'NO_FREE_PLACE' };
    }

    const activeInvite = await this.waitlistRepository.findOne({
      where: {
        event: { id: eventId },
        status: WaitlistStatus.Invited,
      },
    });
    if (activeInvite) {
      return { invited: false, reason: 'INVITE_ALREADY_ACTIVE' };
    }

    const next = await this.waitlistRepository.findOne({
      where: {
        event: { id: eventId },
        status: WaitlistStatus.Waiting,
      },
      relations: { event: { organization: true }, user: true },
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    if (!next) {
      return { invited: false, reason: 'NO_WAITING_USERS' };
    }

    const now = new Date();
    next.status = WaitlistStatus.Invited;
    next.invitedAt = now;
    next.expiresAt = new Date(now.getTime() + inviteTimeoutMinutes * 60 * 1000);

    return { invited: true, waitlist: await this.waitlistRepository.save(next) };
  }

  async acceptWaitlistInvite(userId: number, eventId: number, organizationId: number) {
    const accepted = await this.eventsRepository.manager.transaction(async (manager) => {
      const waitlist = await manager.findOne(Waitlist, {
        where: {
          event: { id: eventId, organization: { id: organizationId } },
          user: { id: userId },
          status: WaitlistStatus.Invited,
        },
        relations: { event: true, user: true },
      });

      if (!waitlist) {
        throw new NotFoundException('Active invite not found');
      }

      if (waitlist.expiresAt && waitlist.expiresAt < new Date()) {
        waitlist.status = WaitlistStatus.Expired;
        await manager.save(waitlist);
        return { accepted: false as const, reason: 'EXPIRED' as const, waitlist };
      }

      const confirmedCount = await manager.count(Participant, {
        where: {
          event: { id: eventId },
          status: ParticipantStatus.Confirmed,
        },
      });

      if (confirmedCount >= waitlist.event.capacity) {
        waitlist.status = WaitlistStatus.Waiting;
        waitlist.invitedAt = null;
        waitlist.expiresAt = null;
        await manager.save(waitlist);
        return { accepted: false as const, reason: 'NO_FREE_PLACE' as const, waitlist };
      }

      const participant = manager.create(Participant, {
        event: { id: eventId },
        user: { id: userId },
        status: ParticipantStatus.Confirmed,
      });

      waitlist.status = WaitlistStatus.Accepted;
      await manager.save(waitlist);
      await manager.save(participant);
      return { accepted: true as const, waitlist, participant };
    });

    if (!accepted.accepted) {
      const invite = await this.inviteNextFromWaitlist(eventId, organizationId);
      await this.sendInviteIfNeeded(invite);
    }

    return accepted;
  }

  async declineWaitlistInvite(userId: number, eventId: number, organizationId: number) {
    const waitlist = await this.waitlistRepository.findOne({
      where: {
        event: { id: eventId, organization: { id: organizationId } },
        user: { id: userId },
        status: WaitlistStatus.Invited,
      },
    });

    if (!waitlist) {
      throw new NotFoundException('Active invite not found');
    }

    waitlist.status = WaitlistStatus.Declined;
    await this.waitlistRepository.save(waitlist);

    const invite = await this.inviteNextFromWaitlist(eventId, organizationId);
    await this.sendInviteIfNeeded(invite);

    return waitlist;
  }

  async expireOldInvites() {
    const expired = await this.waitlistRepository.find({
      where: {
        status: WaitlistStatus.Invited,
        expiresAt: LessThan(new Date()),
      },
      relations: { event: { organization: true } },
    });

    for (const waitlist of expired) {
      waitlist.status = WaitlistStatus.Expired;
      await this.waitlistRepository.save(waitlist);
      const invite = await this.inviteNextFromWaitlist(
        waitlist.event.id,
        waitlist.event.organization.id,
      );
      await this.sendInviteIfNeeded(invite);
    }

    return expired.length;
  }

  myBookings(userId: number, organizationId: number) {
    return this.participantsRepository.find({
      where: {
        user: { id: userId },
        event: { organization: { id: organizationId } },
        status: ParticipantStatus.Confirmed,
      },
      relations: { event: true },
      order: { createdAt: 'DESC' },
    });
  }

  myWaitlist(userId: number, organizationId: number) {
    return this.waitlistRepository.find({
      where: [
        {
          user: { id: userId },
          event: { organization: { id: organizationId } },
          status: WaitlistStatus.Waiting,
        },
        {
          user: { id: userId },
          event: { organization: { id: organizationId } },
          status: WaitlistStatus.Invited,
        },
      ],
      relations: { event: true },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  listParticipants(eventId: number, organizationId?: number) {
    return this.participantsRepository.find({
      where: {
        event: {
          id: eventId,
          ...(organizationId ? { organization: { id: organizationId } } : {}),
        },
        status: ParticipantStatus.Confirmed,
      },
      relations: { user: true, event: true },
      order: { createdAt: 'ASC' },
    });
  }

  listWaitlist(eventId: number, organizationId?: number) {
    return this.waitlistRepository.find({
      where: [
        {
          event: {
            id: eventId,
            ...(organizationId ? { organization: { id: organizationId } } : {}),
          },
          status: WaitlistStatus.Waiting,
        },
        {
          event: {
            id: eventId,
            ...(organizationId ? { organization: { id: organizationId } } : {}),
          },
          status: WaitlistStatus.Invited,
        },
      ],
      relations: { user: true, event: true },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  private countConfirmed(eventId: number) {
    return this.participantsRepository.count({
      where: {
        event: { id: eventId },
        status: ParticipantStatus.Confirmed,
      },
    });
  }

  private countWaiting(eventId: number) {
    return this.waitlistRepository.count({
      where: {
        event: { id: eventId },
        status: WaitlistStatus.Waiting,
      },
    });
  }

  private async assertUserCanJoin(
    manager: EntityManager,
    userId: number,
    eventId: number,
    organizationId: number,
  ) {
    const participant = await manager.findOne(Participant, {
      where: {
        event: { id: eventId, organization: { id: organizationId } },
        user: { id: userId },
        status: ParticipantStatus.Confirmed,
      },
    });
    if (participant) {
      throw new BadRequestException('User already has confirmed booking');
    }

    const waitlist = await manager.findOne(Waitlist, {
      where: [
        {
          event: { id: eventId, organization: { id: organizationId } },
          user: { id: userId },
          status: WaitlistStatus.Waiting,
        },
        {
          event: { id: eventId, organization: { id: organizationId } },
          user: { id: userId },
          status: WaitlistStatus.Invited,
        },
      ],
    });
    if (waitlist) {
      throw new BadRequestException('User is already in active waitlist');
    }
  }

  private async createWaitingRecord(manager, userId: number, eventId: number) {
    const last = await manager.findOne(Waitlist, {
      where: { event: { id: eventId } },
      order: { position: 'DESC' },
    });

    const waitlist = manager.create(Waitlist, {
      event: { id: eventId },
      user: { id: userId },
      status: WaitlistStatus.Waiting,
      position: (last?.position ?? 0) + 1,
      invitedAt: null,
      expiresAt: null,
    });

    return manager.save(waitlist);
  }

  private async sendInviteIfNeeded(invite: InviteResult) {
    if (invite.invited) {
      await this.notificationsService.sendWaitlistInvite(invite.waitlist);
    }
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid event date/time');
    }
    return date;
  }
}
