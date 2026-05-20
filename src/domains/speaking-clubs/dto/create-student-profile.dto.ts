import { SpeakingClubLanguage } from '../entities/speaking-club.enums';

export class CreateStudentProfileDto {
  telegramUserId: string;
  nativeLanguage?: SpeakingClubLanguage | null;
  learningLanguages?: SpeakingClubLanguage[];
  timezone?: string;
}
