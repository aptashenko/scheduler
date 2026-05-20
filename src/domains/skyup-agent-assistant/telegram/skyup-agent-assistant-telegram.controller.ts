import { Body, Controller, Get, Post } from '@nestjs/common';
import { SkyupAgentAssistantBotService } from './skyup-agent-assistant-bot.service';

@Controller('telegram')
export class SkyupAgentAssistantTelegramController {
  constructor(
    private readonly skyupAgentAssistantBotService: SkyupAgentAssistantBotService,
  ) {}

  @Get('status')
  status() {
    return this.skyupAgentAssistantBotService.getStatus();
  }

  @Post('webhook')
  async webhook(@Body() update: unknown) {
    await this.skyupAgentAssistantBotService.handleWebhook(update);
    return { ok: true };
  }

  @Post('webhook/setup')
  async setWebhook(@Body() body: { baseUrl: string }) {
    const url = await this.skyupAgentAssistantBotService.setWebhook(
      body.baseUrl,
    );
    return { ok: true, url };
  }
}
