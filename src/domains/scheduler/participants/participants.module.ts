import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Participant } from './entities/participant.entity';
import { ParticipantsService } from './participants.service';

@Module({
  imports: [TypeOrmModule.forFeature([Participant])],
  providers: [ParticipantsService],
  exports: [ParticipantsService, TypeOrmModule],
})
export class ParticipantsModule {}
