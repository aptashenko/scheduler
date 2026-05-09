import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Participant,
  ParticipantStatus,
} from './entities/participant.entity';

@Injectable()
export class ParticipantsService {
  constructor(
    @InjectRepository(Participant)
    private readonly participantsRepository: Repository<Participant>,
  ) {}

  countConfirmed(eventId: number): Promise<number> {
    return this.participantsRepository.count({
      where: {
        event: { id: eventId },
        status: ParticipantStatus.Confirmed,
      },
    });
  }
}
