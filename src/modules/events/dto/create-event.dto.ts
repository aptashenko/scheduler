export class CreateEventDto {
  organizationId?: number;
  title: string;
  description?: string | null;
  startsAt: string;
  capacity: number;
  level?: string;
  teacher: string;
  locationOrZoomLink: string;
}
