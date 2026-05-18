import { ReminderStatus } from '../entities/reminder.entity';

export class UpdateReminderDto {
  userId?: string;
  telegramChatIds?: string[];
  text?: string;
  remindAt?: string;
  status?: ReminderStatus;
}
