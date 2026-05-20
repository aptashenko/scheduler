import { Body, Controller, Get, Post } from '@nestjs/common';
import { SpeakingClubTelegramService } from './speaking-club-telegram.service';

@Controller('telegram')
export class SpeakingClubTelegramController {
  constructor(
    private readonly speakingClubTelegramService: SpeakingClubTelegramService,
  ) {}

  @Get('status')
  status() {
    return this.speakingClubTelegramService.getStatus();
  }

  @Post('webhook')
  async webhook(@Body() update: unknown) {
    await this.speakingClubTelegramService.handleWebhook(update);
    return { ok: true };
  }

  @Post('webhook/setup')
  async setWebhook(@Body() body: { baseUrl: string }) {
    const url = await this.speakingClubTelegramService.setWebhook(body.baseUrl);
    return { ok: true, url };
  }
}
