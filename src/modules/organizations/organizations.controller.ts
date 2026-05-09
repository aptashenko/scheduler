import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { LogsService } from '../logs/logs.service';
import { TelegramBotService } from '../telegram/telegram-bot.service';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly telegramBotService: TelegramBotService,
    private readonly logsService: LogsService,
  ) {}

  @Get()
  findAll() {
    return this.organizationsService.findAll();
  }

  @Post()
  create(
    @Body()
    body: {
      name: string;
      slug: string;
      botToken: string;
      botUsername?: string | null;
      settings?: Record<string, unknown>;
    },
  ) {
    return this.organizationsService.create(body);
  }

  @Patch(':id/settings')
  updateSettings(@Param('id') id: string, @Body() settings: Record<string, unknown>) {
    return this.organizationsService.updateSettings(Number(id), settings);
  }

  @Post(':id/webhook')
  async setWebhook(
    @Param('id') id: string,
    @Body() body: { baseUrl: string },
  ) {
    const url = await this.telegramBotService.setWebhook(Number(id), body.baseUrl);
    return { ok: true, url };
  }

  @Get(':id/logs')
  logs(@Param('id') id: string) {
    return this.logsService.findByOrganization(Number(id));
  }
}
