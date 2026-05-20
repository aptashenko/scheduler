import { ReminderStatus } from '../entities/reminder.entity';

export class UpdateReminderDto {
  userId?: string;
  telegramChatIds?: string[];
  text?: string;
  remindAt?: string;
  eventAt?: string;
  remindBeforeMinutes?: number | null;
  status?: ReminderStatus;
}
