export class CreateUserDto {
  telegramId: string;
  telegramName: string | null;
  firstName?: string | null;
  lastName?: string | null;
}
