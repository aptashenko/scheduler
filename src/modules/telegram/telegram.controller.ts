import { Body, Controller, Param, Post } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramBotService: TelegramBotService) {}

  @Post('webhook/:organizationId')
  async webhook(@Param('organizationId') organizationId: string, @Body() update: unknown) {
    await this.telegramBotService.handleWebhook(Number(organizationId), update);
    return { ok: true };
  }
}
