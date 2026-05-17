import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventsModule } from '../events/events.module';
import { Waitlist } from './entities/waitlist.entity';
import { WaitlistService } from './waitlist.service';

@Module({
  imports: [TypeOrmModule.forFeature([Waitlist]), forwardRef(() => EventsModule)],
  providers: [WaitlistService],
  exports: [WaitlistService, TypeOrmModule],
})
export class WaitlistModule {}
