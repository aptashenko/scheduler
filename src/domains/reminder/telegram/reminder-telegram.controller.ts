import { Body, Controller, Get, Post } from '@nestjs/common';
import { ReminderBotService } from './reminder-bot.service';

@Controller('telegram')
export class ReminderTelegramController {
  constructor(private readonly reminderBotService: ReminderBotService) {}

  @Get('status')
  status() {
    return this.reminderBotService.getStatus();
  }

  @Post('webhook')
  async webhook(@Body() update: unknown) {
    await this.reminderBotService.handleWebhook(update);
    return { ok: true };
  }

  @Post('webhook/setup')
  async setWebhook(@Body() body: { baseUrl: string }) {
    const url = await this.reminderBotService.setWebhook(body.baseUrl);
    return { ok: true, url };
  }
}
