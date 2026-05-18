import {
  SpeakingClubLanguage,
  SpeakingClubLevel,
} from '../entities/speaking-club.enums';

export class SearchSpeakingClubsDto {
  targetLanguage: SpeakingClubLanguage;
  supportLanguage: SpeakingClubLanguage;
  level: SpeakingClubLevel;
}
