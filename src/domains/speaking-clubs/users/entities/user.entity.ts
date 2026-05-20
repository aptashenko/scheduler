import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DATABASE_SCHEMAS } from '../../../../database/schemas';

export enum UserRole {
  Student = 'STUDENT',
  Teacher = 'TEACHER',
  Admin = 'ADMIN',
}

@Entity({ name: 'speaking_club_users', schema: DATABASE_SCHEMAS.speakingClubs })
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'bigint' })
  telegramId: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  username: string | null;

  @Index()
  @Column({ type: 'enum', enum: UserRole, default: UserRole.Student })
  role: UserRole;

  @Column({ type: 'varchar', length: 80, nullable: true })
  timezone: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
