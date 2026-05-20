import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DATABASE_SCHEMAS } from '../../../database/schemas';
import { ClubSession } from './club-session.entity';
import { SessionBooking } from './session-booking.entity';
import { StudentProfile } from './student-profile.entity';
import { SessionAttendanceStatus } from './speaking-club.enums';

@Entity({
  name: 'speaking_club_session_attendance',
  schema: DATABASE_SCHEMAS.speakingClubs,
})
export class SessionAttendance {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @ManyToOne(() => ClubSession, { nullable: false })
  session: ClubSession;

  @Index()
  @ManyToOne(() => SessionBooking, { nullable: false })
  booking: SessionBooking;

  @Index()
  @ManyToOne(() => StudentProfile, { nullable: false })
  student: StudentProfile;

  @Column({ type: 'timestamp', nullable: true })
  joinedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  leftAt: Date | null;

  @Column({ type: 'int', default: 0 })
  durationMinutes: number;

  @Index()
  @Column({ type: 'enum', enum: SessionAttendanceStatus })
  status: SessionAttendanceStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
