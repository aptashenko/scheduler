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
import { TeacherProfile } from './teacher-profile.entity';
import { ClubSession } from './club-session.entity';
import { SpeakingClubLanguage, SpeakingClubLevel } from './speaking-club.enums';

@Entity({ name: 'speaking_clubs', schema: DATABASE_SCHEMAS.speakingClubs })
export class SpeakingClub {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @ManyToOne(() => TeacherProfile, { nullable: false })
  teacher: TeacherProfile;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Index()
  @Column({ type: 'enum', enum: SpeakingClubLanguage })
  targetLanguage: SpeakingClubLanguage;

  @Column({ type: 'enum', enum: SpeakingClubLanguage, array: true })
  supportLanguages: SpeakingClubLanguage[];

  @Column({
    type: 'enum',
    enum: SpeakingClubLevel,
    enumName: 'speaking_clubs_level_enum',
    nullable: true,
  })
  level: SpeakingClubLevel | null;

  @Column({
    type: 'enum',
    enum: SpeakingClubLevel,
    enumName: 'speaking_clubs_level_enum',
    array: true,
  })
  levels: SpeakingClubLevel[];

  @Column({ type: 'int' })
  durationMinutes: number;

  @Column({ type: 'int' })
  capacity: number;

  @Column({ type: 'int', default: 0 })
  price: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string;

  @Index()
  @Column({ type: 'boolean', default: false })
  isFree: boolean;

  @Index()
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => ClubSession, (session) => session.club)
  sessions: ClubSession[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
