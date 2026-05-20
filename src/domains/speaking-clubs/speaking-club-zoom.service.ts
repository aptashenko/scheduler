import { BadRequestException, Injectable } from '@nestjs/common';
import { ClubSession } from './entities/club-session.entity';
import { SessionBooking } from './entities/session-booking.entity';

type ZoomTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type ZoomRegistrantResponse = {
  id: string;
  join_url: string;
};

type CreateZoomMeetingInput = {
  title: string;
  description: string | null;
  startAt: Date;
  durationMinutes: number;
  timezone: string;
};

type ZoomMeetingResponse = {
  id: number;
  join_url: string;
  start_url?: string;
};

@Injectable()
export class SpeakingClubZoomService {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  async createMeeting(input: CreateZoomMeetingInput) {
    const hostUserId = process.env.ZOOM_HOST_USER_ID;
    if (!hostUserId) {
      throw new BadRequestException('ZOOM_HOST_USER_ID is not configured');
    }

    const accessToken = await this.getAccessToken();
    const response = await fetch(
      `https://api.zoom.us/v2/users/${encodeURIComponent(hostUserId)}/meetings`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topic: input.title,
          agenda: input.description ?? undefined,
          type: 2,
          start_time: input.startAt.toISOString(),
          duration: input.durationMinutes,
          timezone: input.timezone,
          settings: {
            approval_type: 0,
            registration_type: 1,
            registrants_email_notification: false,
            waiting_room: true,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new BadRequestException(
        `Zoom meeting creation failed: ${await response.text()}`,
      );
    }

    const meeting = (await response.json()) as ZoomMeetingResponse;
    await this.enableRegistration(String(meeting.id), accessToken);
    return {
      meetingId: String(meeting.id),
      joinUrl: meeting.join_url,
      startUrl: meeting.start_url ?? null,
    };
  }

  async registerBookingRegistrant(session: ClubSession, booking: SessionBooking) {
    if (!session.zoomMeetingId) {
      throw new BadRequestException('Zoom meeting id is required for booking');
    }

    const accessToken = await this.getAccessToken();
    const email = this.buildRegistrantEmail(booking);
    const firstName = `Booking ${booking.id}`;
    const lastName = `Student ${booking.student.id}`;
    const response = await fetch(
      `https://api.zoom.us/v2/meetings/${encodeURIComponent(session.zoomMeetingId)}/registrants`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          first_name: firstName,
          last_name: lastName,
          auto_approve: true,
        }),
      },
    );

    if (!response.ok) {
      throw new BadRequestException(
        `Zoom registrant creation failed: ${await response.text()}`,
      );
    }

    const registrant = (await response.json()) as ZoomRegistrantResponse;
    return {
      zoomRegistrantId: registrant.id,
      zoomRegistrantEmail: email,
      uniqueZoomUrl: registrant.join_url,
    };
  }

  private async enableRegistration(meetingId: string, accessToken: string) {
    const response = await fetch(
      `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          settings: {
            approval_type: 0,
            registration_type: 1,
            registrants_email_notification: false,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new BadRequestException(
        `Zoom registration setup failed: ${await response.text()}`,
      );
    }
  }

  async getMeetingParticipants(meetingId: string) {
    // TODO: Connect Zoom reports/webhooks and map registrants to bookings.
    return { meetingId, participants: [] };
  }

  async cancelMeeting(meetingId: string) {
    // TODO: Connect Zoom API cancellation.
    return { meetingId, cancelled: false };
  }

  private async getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    const accountId = process.env.ZOOM_ACCOUNT_ID;
    const clientId = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;
    if (!accountId || !clientId || !clientSecret) {
      throw new BadRequestException('Zoom API credentials are not configured');
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      'base64',
    );
    const response = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      },
    );

    if (!response.ok) {
      throw new BadRequestException(
        `Zoom access token request failed: ${await response.text()}`,
      );
    }

    const token = (await response.json()) as ZoomTokenResponse;
    this.accessToken = token.access_token;
    this.accessTokenExpiresAt = Date.now() + (token.expires_in - 60) * 1000;
    return this.accessToken;
  }

  private buildRegistrantEmail(booking: SessionBooking) {
    const domain =
      process.env.SPEAKING_CLUBS_ZOOM_REGISTRANT_EMAIL_DOMAIN ??
      'speaking-clubs.local';
    return `booking-${booking.id}-student-${booking.student.id}@${domain}`;
  }
}
