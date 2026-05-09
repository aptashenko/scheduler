import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EventsModule } from './modules/events/events.module';
import { initDatabase } from './database/config';
import { LogsModule } from './modules/logs/logs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ParticipantsModule } from './modules/participants/participants.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { UsersModule } from './modules/users/users.module';
import { WaitlistModule } from './modules/waitlist/waitlist.module';

@Module({
  imports: [
    initDatabase(),
    ScheduleModule.forRoot(),
    LogsModule,
    OrganizationsModule,
    NotificationsModule,
    UsersModule,
    EventsModule,
    ParticipantsModule,
    WaitlistModule,
    TelegramModule,
    SchedulerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
