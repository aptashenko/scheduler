import { Injectable, ServiceUnavailableException } from '@nestjs/common';

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleMeetSpaceResponse = {
  meetingUri?: string;
  meetingCode?: string;
  name?: string;
  error?: {
    message?: string;
    status?: string;
  };
};

@Injectable()
export class SkyupAgentAssistantService {
  isConfigured() {
    return Boolean(
      process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
    );
  }

  async createInstantMeeting() {
    const accessToken = await this.getAccessToken();
    const response = await fetch('https://meet.googleapis.com/v2/spaces', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          accessType: process.env.GOOGLE_MEET_ACCESS_TYPE ?? 'OPEN',
        },
      }),
    });
    const data = (await response.json()) as GoogleMeetSpaceResponse;

    if (!response.ok || !data.meetingUri) {
      throw new ServiceUnavailableException(
        data.error?.message ?? 'Google Meet space was not created',
      );
    }

    return {
      code: data.meetingCode ?? null,
      name: data.name ?? null,
      uri: data.meetingUri,
    };
  }

  private async getAccessToken() {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      throw new ServiceUnavailableException('Google OAuth is not configured');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    const data = (await response.json()) as GoogleTokenResponse;

    if (!response.ok || !data.access_token) {
      throw new ServiceUnavailableException(
        data.error_description ?? data.error ?? 'Google OAuth token failed',
      );
    }

    return data.access_token;
  }
}
