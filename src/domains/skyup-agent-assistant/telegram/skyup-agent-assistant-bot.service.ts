import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Context, Telegraf } from 'telegraf';
import { SkyupAgentAssistantService } from '../skyup-agent-assistant.service';

type SkyupAgentAssistantBotMode = 'polling' | 'webhook';

@Injectable()
export class SkyupAgentAssistantBotService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SkyupAgentAssistantBotService.name);
  private bot?: Telegraf;
  private pollingStarted = false;

  constructor(
    private readonly skyupAgentAssistantService: SkyupAgentAssistantService,
  ) {}

  async onModuleInit() {
    const token = process.env.SKYUP_AGENT_ASSISTANT_TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.warn(
        'SKYUP_AGENT_ASSISTANT_TELEGRAM_BOT_TOKEN is not set. SkyUp agent assistant bot is disabled.',
      );
      return;
    }

    this.bot = new Telegraf(token);
    this.registerHandlers(this.bot);

    if (this.getMode() === 'webhook') {
      this.logger.log('SkyUp agent assistant bot initialized in webhook mode');
      return;
    }
    if (process.env.SKYUP_AGENT_ASSISTANT_TELEGRAM_POLLING !== 'true') {
      this.logger.log(
        'SkyUp agent assistant polling is disabled. Set SKYUP_AGENT_ASSISTANT_TELEGRAM_POLLING=true to enable it.',
      );
      return;
    }

    await this.bot.telegram.deleteWebhook();
    await this.bot.launch({ dropPendingUpdates: true });
    this.pollingStarted = true;
    this.logger.log('SkyUp agent assistant bot started in polling mode');
  }

  onModuleDestroy() {
    this.pollingStarted = false;
    this.bot?.stop('Nest application shutdown');
  }

  getStatus() {
    return {
      googleConfigured: this.skyupAgentAssistantService.isConfigured(),
      initialized: Boolean(this.bot),
      mode: this.getMode(),
      pollingStarted: this.pollingStarted,
      tokenConfigured: Boolean(
        process.env.SKYUP_AGENT_ASSISTANT_TELEGRAM_BOT_TOKEN,
      ),
    };
  }

  async handleWebhook(update: unknown) {
    if (!this.bot) {
      throw new Error('SkyUp agent assistant bot is not initialized');
    }

    await this.bot.handleUpdate(update as never);
  }

  async setWebhook(baseUrl: string) {
    if (!this.bot) {
      throw new Error('SkyUp agent assistant bot is not initialized');
    }

    const url = `${baseUrl.replace(/\/$/, '')}/skyup-agent-assistant/telegram/webhook`;
    await this.bot.telegram.setWebhook(url);
    return url;
  }

  private registerHandlers(bot: Telegraf) {
    bot.catch((error) => {
      this.logger.error('SkyUp agent assistant bot update failed', error);
    });

    bot.start(async (ctx) => {
      await ctx.reply('Send /meet to create an instant Google Meet link.');
    });

    bot.command('meet', async (ctx) => {
      await this.replyInstantMeet(ctx);
    });

    bot.hears(/^meet$/i, async (ctx) => {
      await this.replyInstantMeet(ctx);
    });
  }

  private async replyInstantMeet(ctx: Context) {
    try {
      const meeting =
        await this.skyupAgentAssistantService.createInstantMeeting();
      await ctx.reply(['Google Meet', meeting.uri].join('\n'));
    } catch (error) {
      this.logger.error('Failed to create instant Google Meet', error);
      await ctx.reply('Could not create Google Meet link.');
    }
  }

  private getMode(): SkyupAgentAssistantBotMode {
    return process.env.SKYUP_AGENT_ASSISTANT_BOT_MODE === 'webhook'
      ? 'webhook'
      : 'polling';
  }
}
