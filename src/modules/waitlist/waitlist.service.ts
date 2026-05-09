import { Injectable } from '@nestjs/common';
import { EventsService } from '../events/events.service';

@Injectable()
export class WaitlistService {
  constructor(private readonly eventsService: EventsService) {}

  joinWaitlist(userId: number, eventId: number, organizationId: number) {
    return this.eventsService.joinWaitlist(userId, eventId, organizationId);
  }

  inviteNextFromWaitlist(eventId: number) {
    return this.eventsService.inviteNextFromWaitlist(eventId);
  }

  acceptWaitlistInvite(userId: number, eventId: number, organizationId: number) {
    return this.eventsService.acceptWaitlistInvite(userId, eventId, organizationId);
  }

  declineWaitlistInvite(userId: number, eventId: number, organizationId: number) {
    return this.eventsService.declineWaitlistInvite(userId, eventId, organizationId);
  }
}
