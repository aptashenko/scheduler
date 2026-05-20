import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { DATABASE_SCHEMAS } from '../../../database/schemas';
import { ClubSession } from './club-session.entity';

export enum SessionReminderType {
  StartsIn30Minutes = 'STARTS_IN_30_MINUTES',
}

@Entity({
  name: 'speaking_club_session_reminders',
  schema: DATABASE_SCHEMAS.speakingClubs,
})
@Unique(['session', 'recipientTelegramId', 'type'])
export class SessionReminder {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @ManyToOne(() => ClubSession, { nullable: false })
  session: ClubSession;

  @Index()
  @Column({ type: 'bigint' })
  recipientTelegramId: string;

  @Index()
  @Column({ type: 'enum', enum: SessionReminderType })
  type: SessionReminderType;

  @CreateDateColumn()
  sentAt: Date;
}
