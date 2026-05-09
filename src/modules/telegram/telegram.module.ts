import { forwardRef, Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { LogsModule } from '../app-logs/logs.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { UsersModule } from '../users/users.module';
import { TelegramController } from './telegram.controller';
import { TelegramBotService } from './telegram-bot.service';

@Module({
  imports: [
    LogsModule,
    UsersModule,
    forwardRef(() => OrganizationsModule),
    forwardRef(() => EventsModule),
  ],
  controllers: [TelegramController],
  providers: [TelegramBotService],
  exports: [TelegramBotService],
})
export class TelegramModule {}
