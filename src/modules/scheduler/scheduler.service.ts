import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventsService } from '../events/events.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(private readonly eventsService: EventsService) {}

  @Cron('* * * * *')
  async expireOldInvites() {
    const count = await this.eventsService.expireOldInvites();
    if (count > 0) {
      this.logger.log(`Expired ${count} waitlist invite(s)`);
    }
  }
}
