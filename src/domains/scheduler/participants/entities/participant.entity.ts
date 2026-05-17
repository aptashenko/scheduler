import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Event } from '../../events/entities/event.entity';
import { User } from '../../users/entities/user.entity';

export enum ParticipantStatus {
  Confirmed = 'CONFIRMED',
  Cancelled = 'CANCELLED',
  Attended = 'ATTENDED',
  NoShow = 'NO_SHOW',
}

@Entity('participants')
@Index(['event', 'user'])
@Index(['event', 'status'])
export class Participant {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Event, (event) => event.participants, { nullable: false })
  event: Event;

  @ManyToOne(() => User, (user) => user.participants, { nullable: false })
  user: User;

  @Column({
    type: 'enum',
    enum: ParticipantStatus,
    default: ParticipantStatus.Confirmed,
  })
  status: ParticipantStatus;

  @CreateDateColumn()
  createdAt: Date;
}
