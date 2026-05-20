import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DATABASE_SCHEMAS } from '../../../database/schemas';
import { User } from '../users/entities/user.entity';
import { TeacherPayoutStatus } from './speaking-club.enums';

@Entity({
  name: 'speaking_club_teacher_profiles',
  schema: DATABASE_SCHEMAS.speakingClubs,
})
export class TeacherProfile {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'bigint' })
  telegramUserId: string;

  @Index({ unique: true })
  @OneToOne(() => User, { nullable: false })
  @JoinColumn()
  user: User;

  @Column({ type: 'varchar', length: 160 })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ type: 'varchar', length: 80 })
  timezone: string;

  @Index()
  @Column({
    type: 'enum',
    enum: TeacherPayoutStatus,
    default: TeacherPayoutStatus.NotConfigured,
  })
  payoutStatus: TeacherPayoutStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
