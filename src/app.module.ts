import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { initDatabase } from './database/config';
import { ReminderDomainModule } from './domains/reminder/reminder-domain.module';
import { SkyupAgentAssistantDomainModule } from './domains/skyup-agent-assistant/skyup-agent-assistant-domain.module';
import { SpeakingClubsDomainModule } from './domains/speaking-clubs/speaking-clubs-domain.module';

@Module({
  imports: [
    initDatabase(),
    ScheduleModule.forRoot(),
    ReminderDomainModule,
    SkyupAgentAssistantDomainModule,
    SpeakingClubsDomainModule,
    RouterModule.register([
      {
        path: 'skyup-agent-assistant',
        module: SkyupAgentAssistantDomainModule,
      },
      {
        path: 'reminder',
        module: ReminderDomainModule,
      },
      {
        path: 'speaking-clubs',
        module: SpeakingClubsDomainModule,
      },
    ]),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
