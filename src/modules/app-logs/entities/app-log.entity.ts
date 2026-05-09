import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';

export enum AppLogLevel {
  Error = 'ERROR',
  Warn = 'WARN',
  Info = 'INFO',
}

@Entity('app_logs')
@Index(['organization', 'level', 'createdAt'])
export class AppLog {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: true })
  organization: Organization | null;

  @Column({ type: 'enum', enum: AppLogLevel })
  level: AppLogLevel;

  @Column({ type: 'varchar', length: 120 })
  source: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'text', nullable: true })
  stack: string | null;

  @Column({ type: 'jsonb', nullable: true })
  context: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}
