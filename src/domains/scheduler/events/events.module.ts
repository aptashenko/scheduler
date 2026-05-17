import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationsModule } from '../organizations/organizations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ParticipantsModule } from '../participants/participants.module';
import { UsersModule } from '../users/users.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { Participant } from '../participants/entities/participant.entity';
import { Waitlist } from '../waitlist/entities/waitlist.entity';
import { Event } from './entities/event.entity';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Event, Participant, Waitlist]),
    OrganizationsModule,
    forwardRef(() => NotificationsModule),
    UsersModule,
    ParticipantsModule,
    forwardRef(() => WaitlistModule),
  ],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService, TypeOrmModule],
})
export class EventsModule {}
