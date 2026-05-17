export class CreateReminderDto {
  userId: number;
  telegramChatId: string;
  text: string;
  remindAt: string;
}
