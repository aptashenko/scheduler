import { forwardRef, Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [forwardRef(() => TelegramModule)],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
