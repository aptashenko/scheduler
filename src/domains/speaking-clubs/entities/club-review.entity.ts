import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DATABASE_SCHEMAS } from '../../../database/schemas';
import { SpeakingClub } from './speaking-club.entity';
import { ClubSession } from './club-session.entity';
import { StudentProfile } from './student-profile.entity';

@Entity({ name: 'speaking_club_reviews', schema: DATABASE_SCHEMAS.speakingClubs })
export class ClubReview {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @ManyToOne(() => SpeakingClub, { nullable: false })
  club: SpeakingClub;

  @Index()
  @ManyToOne(() => ClubSession, { nullable: false })
  session: ClubSession;

  @Index()
  @ManyToOne(() => StudentProfile, { nullable: false })
  student: StudentProfile;

  @Column({ type: 'int' })
  rating: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
