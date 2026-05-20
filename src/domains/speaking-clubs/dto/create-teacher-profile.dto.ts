export class CreateTeacherProfileDto {
  telegramUserId: string;
  displayName: string;
  bio?: string | null;
  timezone?: string;
}
