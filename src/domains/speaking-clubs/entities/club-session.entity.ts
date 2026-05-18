import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DATABASE_SCHEMAS } from '../../../database/schemas';
import { SpeakingClub } from './speaking-club.entity';
import { TeacherProfile } from './teacher-profile.entity';
import { ClubSessionStatus } from './speaking-club.enums';
import { SessionBooking } from './session-booking.entity';

@Entity({ name: 'speaking_club_sessions', schema: DATABASE_SCHEMAS.speakingClubs })
export class ClubSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @ManyToOne(() => SpeakingClub, (club) => club.sessions, { nullable: false })
  club: SpeakingClub;

  @Index()
  @ManyToOne(() => TeacherProfile, { nullable: false })
  teacher: TeacherProfile;

  @Index()
  @Column({ type: 'timestamp' })
  startAt: Date;

  @Column({ type: 'timestamp' })
  endAt: Date;

  @Column({ type: 'varchar', length: 80 })
  timezone: string;

  @Index()
  @Column({
    type: 'enum',
    enum: ClubSessionStatus,
    default: ClubSessionStatus.Scheduled,
  })
  status: ClubSessionStatus;

  @Column({ type: 'varchar', length: 160, nullable: true })
  zoomMeetingId: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  zoomJoinUrl: string | null;

  @OneToMany(() => SessionBooking, (booking) => booking.session)
  bookings: SessionBooking[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
