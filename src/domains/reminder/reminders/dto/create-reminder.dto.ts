export class CreateReminderDto {
  userId: string;
  telegramChatIds: string[];
  text: string;
  remindAt?: string;
  eventAt?: string;
  remindBeforeMinutes?: number;
}
