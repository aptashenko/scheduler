import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DATABASE_SCHEMAS } from '../../../database/schemas';
import { SessionBooking } from './session-booking.entity';
import { StudentProfile } from './student-profile.entity';
import { TeacherProfile } from './teacher-profile.entity';
import { PaymentProvider, PaymentStatus } from './speaking-club.enums';

@Entity({ name: 'speaking_club_payments', schema: DATABASE_SCHEMAS.speakingClubs })
export class Payment {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @OneToOne(() => SessionBooking, { nullable: false })
  @JoinColumn()
  booking: SessionBooking;

  @Index()
  @ManyToOne(() => StudentProfile, { nullable: false })
  student: StudentProfile;

  @Index()
  @ManyToOne(() => TeacherProfile, { nullable: false })
  teacher: TeacherProfile;

  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'enum', enum: PaymentProvider })
  provider: PaymentProvider;

  @Index()
  @Column({ type: 'enum', enum: PaymentStatus })
  status: PaymentStatus;

  @Column({ type: 'varchar', length: 200, nullable: true })
  externalPaymentId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
