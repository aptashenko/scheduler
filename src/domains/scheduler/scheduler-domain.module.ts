import { Module } from '@nestjs/common';
import { LogsModule } from './app-logs/logs.module';
import { EventsModule } from './events/events.module';
import { SchedulerModule } from './jobs/scheduler.module';
import { MembersModule } from './members/members.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ParticipantsModule } from './participants/participants.module';
import { TelegramModule } from './telegram/telegram.module';
import { UsersModule } from './users/users.module';
import { WaitlistModule } from './waitlist/waitlist.module';

@Module({
  imports: [
    LogsModule,
    OrganizationsModule,
    NotificationsModule,
    UsersModule,
    EventsModule,
    ParticipantsModule,
    WaitlistModule,
    TelegramModule,
    MembersModule,
    SchedulerModule,
  ],
})
export class SchedulerDomainModule {}
