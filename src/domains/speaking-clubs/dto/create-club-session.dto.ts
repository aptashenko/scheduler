export class CreateClubSessionDto {
  clubId: number;
  startAt: string;
  timezone: string;
  zoomMeetingId?: string | null;
  zoomJoinUrl?: string | null;
}
