import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [EventsModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
