import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { TelegramBotService } from '../telegram/telegram-bot.service';
import { Event } from '../events/entities/event.entity';
import { Waitlist } from '../waitlist/entities/waitlist.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(forwardRef(() => TelegramBotService))
    private readonly telegramBotService: TelegramBotService,
  ) {}

  sendWaitlistInvite(waitlist: Waitlist) {
    return this.telegramBotService.sendWaitlistInvite(waitlist);
  }

  notifyUsers(
    telegramIds: string[],
    message: string,
    organizationId: number,
  ) {
    return this.telegramBotService.notifyUsers(telegramIds, message, organizationId);
  }

  announceNewEvent(
    telegramIds: string[],
    event: Event,
    organizationId: number,
  ) {
    return this.telegramBotService.announceNewEvent(
      telegramIds,
      event,
      organizationId,
    );
  }
}
