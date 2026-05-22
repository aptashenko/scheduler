import { ReminderRecurrenceFrequency } from '../entities/reminder-series.entity';

export class ReminderRecurrenceDto {
  frequency: ReminderRecurrenceFrequency;
  weekday?: number;
  dayOfMonth?: number;
  timezone: string;
}

export class CreateReminderDto {
  userId: string;
  telegramChatIds: string[];
  text: string;
  remindAt?: string;
  eventAt?: string;
  remindBeforeMinutes?: number;
  recurrence?: ReminderRecurrenceDto;
}
