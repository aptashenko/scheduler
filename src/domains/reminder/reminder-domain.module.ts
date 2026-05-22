import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReminderAiService } from './ai/reminder-ai.service';
import { ReminderParserService } from './parser/reminder-parser.service';
import { StrictReminderParserService } from './parser/strict-reminder-parser.service';
import { Reminder } from './reminders/entities/reminder.entity';
import { ReminderSeries } from './reminders/entities/reminder-series.entity';
import {
  ReminderUserGroupMember,
  Users,
} from './reminders/entities/users.entity';
import { ReminderDailySummaryService } from './reminders/reminder-daily-summary.service';
import { reminderQueueProvider } from './reminders/reminder-queue.provider';
import { RemindersController } from './reminders/reminders.controller';
import { RemindersService } from './reminders/reminders.service';
import { RemindersWorker } from './reminders/reminders.worker';
import { UsersService } from './reminders/users.service';
import { ReminderTelegramController } from './telegram/reminder-telegram.controller';
import { ReminderBotService } from './telegram/reminder-bot.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Reminder,
      ReminderSeries,
      Users,
      ReminderUserGroupMember,
    ]),
  ],
  controllers: [ReminderTelegramController, RemindersController],
  providers: [
    reminderQueueProvider,
    ReminderAiService,
    ReminderDailySummaryService,
    ReminderParserService,
    ReminderBotService,
    RemindersService,
    UsersService,
    RemindersWorker,
    StrictReminderParserService,
  ],
})
export class ReminderDomainModule {}
