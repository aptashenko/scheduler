import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReminderAiService } from './ai/reminder-ai.service';
import { ReminderParserService } from './parser/reminder-parser.service';
import { StrictReminderParserService } from './parser/strict-reminder-parser.service';
import { Reminder } from './reminders/entities/reminder.entity';
import { reminderQueueProvider } from './reminders/reminder-queue.provider';
import { RemindersController } from './reminders/reminders.controller';
import { RemindersService } from './reminders/reminders.service';
import { RemindersWorker } from './reminders/reminders.worker';
import { ReminderTelegramController } from './telegram/reminder-telegram.controller';
import { ReminderBotService } from './telegram/reminder-bot.service';

@Module({
  imports: [TypeOrmModule.forFeature([Reminder])],
  controllers: [ReminderTelegramController, RemindersController],
  providers: [
    reminderQueueProvider,
    ReminderAiService,
    ReminderParserService,
    ReminderBotService,
    RemindersService,
    RemindersWorker,
    StrictReminderParserService,
  ],
})
export class ReminderDomainModule {}
