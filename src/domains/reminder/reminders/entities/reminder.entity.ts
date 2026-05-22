import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DATABASE_SCHEMAS } from '../../../../database/schemas';
import { ReminderSeries } from './reminder-series.entity';
import { Users } from './users.entity';

export enum ReminderStatus {
  Pending = 'pending',
  Sent = 'sent',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

@Entity({ name: 'reminders', schema: DATABASE_SCHEMAS.reminder })
export class Reminder {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @Index()
  @Column({ name: 'series_id', type: 'int', nullable: true })
  seriesId: number | null;

  @Index()
  @Column({ name: 'telegram_chat_ids', type: 'text', array: true })
  telegramChatIds: string[];

  @Column({ type: 'text' })
  text: string;

  @Index()
  @Column({ name: 'remind_at', type: 'timestamptz' })
  remindAt: Date;

  @Index()
  @Column({ name: 'event_at', type: 'timestamptz', nullable: true })
  eventAt: Date | null;

  @Column({ name: 'remind_before_minutes', type: 'int', nullable: true })
  remindBeforeMinutes: number | null;

  @Index()
  @Column({
    type: 'enum',
    enum: ReminderStatus,
    default: ReminderStatus.Pending,
  })
  status: ReminderStatus;

  @Column({ name: 'bull_job_id', type: 'varchar', length: 128, nullable: true })
  bullJobId: string | null;

  @Column({
    name: 'before_bull_job_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  beforeBullJobId: string | null;

  @ManyToOne(() => Users, (user) => user.reminders, {
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'telegramId' })
  user: Users;

  @ManyToOne(() => ReminderSeries, (series) => series.reminders, {
    createForeignKeyConstraints: false,
    nullable: true,
  })
  @JoinColumn({ name: 'series_id' })
  series?: ReminderSeries | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'before_sent_at', type: 'timestamptz', nullable: true })
  beforeSentAt: Date | null;
}
