import {
  SpeakingClubLanguage,
  SpeakingClubLevel,
} from '../entities/speaking-club.enums';

export class CreateSpeakingClubDto {
  teacherId: number;
  title: string;
  description?: string | null;
  targetLanguage: SpeakingClubLanguage;
  supportLanguages: SpeakingClubLanguage[];
  levels: SpeakingClubLevel[];
  durationMinutes: number;
  capacity: number;
  price?: number;
  currency?: string;
  isFree: boolean;
}
