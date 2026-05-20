import { Module } from '@nestjs/common';
import { SkyupAgentAssistantService } from './skyup-agent-assistant.service';
import { SkyupAgentAssistantTelegramController } from './telegram/skyup-agent-assistant-telegram.controller';
import { SkyupAgentAssistantBotService } from './telegram/skyup-agent-assistant-bot.service';

@Module({
  controllers: [SkyupAgentAssistantTelegramController],
  providers: [SkyupAgentAssistantBotService, SkyupAgentAssistantService],
})
export class SkyupAgentAssistantDomainModule {}
