import { ReminderStatus } from '../entities/reminder.entity';

export class UpdateReminderDto {
  userId?: number;
  telegramChatId?: string;
  text?: string;
  remindAt?: string;
  status?: ReminderStatus;
}
