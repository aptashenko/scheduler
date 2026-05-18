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
import { SpeakingClubLanguage } from './speaking-club.enums';

@Entity({
  name: 'speaking_club_student_profiles',
  schema: DATABASE_SCHEMAS.speakingClubs,
})
export class StudentProfile {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'bigint' })
  telegramUserId: string;

  @Index({ unique: true })
  @OneToOne(() => User, { nullable: false })
  @JoinColumn()
  user: User;

  @Column({ type: 'enum', enum: SpeakingClubLanguage, nullable: true })
  nativeLanguage: SpeakingClubLanguage | null;

  @Column({
    type: 'enum',
    enum: SpeakingClubLanguage,
    array: true,
    default: [],
  })
  learningLanguages: SpeakingClubLanguage[];

  @Column({ type: 'varchar', length: 80 })
  timezone: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
