import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { DATABASE_SCHEMAS } from '../../../database/schemas';
import { ClubSession } from './club-session.entity';
import { StudentProfile } from './student-profile.entity';
import {
  SessionBookingPaymentStatus,
  SessionBookingStatus,
} from './speaking-club.enums';

@Entity({
  name: 'speaking_club_session_bookings',
  schema: DATABASE_SCHEMAS.speakingClubs,
})
@Unique(['session', 'student'])
export class SessionBooking {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @ManyToOne(() => ClubSession, (session) => session.bookings, { nullable: false })
  session: ClubSession;

  @Index()
  @ManyToOne(() => StudentProfile, { nullable: false })
  student: StudentProfile;

  @Index()
  @Column({
    type: 'enum',
    enum: SessionBookingStatus,
    default: SessionBookingStatus.PendingPayment,
  })
  status: SessionBookingStatus;

  @Index()
  @Column({
    type: 'enum',
    enum: SessionBookingPaymentStatus,
    default: SessionBookingPaymentStatus.Pending,
  })
  paymentStatus: SessionBookingPaymentStatus;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 80 })
  uniqueJoinToken: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  uniqueZoomUrl: string | null;

  @Index({ unique: true, where: '"zoomRegistrantId" IS NOT NULL' })
  @Column({ type: 'varchar', length: 200, nullable: true })
  zoomRegistrantId: string | null;

  @Column({ type: 'varchar', length: 320, nullable: true })
  zoomRegistrantEmail: string | null;

  @Column({ type: 'timestamp' })
  bookedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
