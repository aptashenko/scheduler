import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DATABASE_SCHEMAS } from '../../../../database/schemas';
import { Reminder } from './reminder.entity';

export enum ReminderRecurrenceFrequency {
  Weekly = 'weekly',
  Monthly = 'monthly',
}

export enum ReminderSeriesStatus {
  Active = 'active',
  Cancelled = 'cancelled',
}

@Entity({ name: 'reminder_series', schema: DATABASE_SCHEMAS.reminder })
export class ReminderSeries {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @Column({ name: 'telegram_chat_ids', type: 'text', array: true })
  telegramChatIds: string[];

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'enum', enum: ReminderRecurrenceFrequency })
  frequency: ReminderRecurrenceFrequency;

  @Column({ name: 'weekday', type: 'int', nullable: true })
  weekday: number | null;

  @Column({ name: 'day_of_month', type: 'int', nullable: true })
  dayOfMonth: number | null;

  @Column({ name: 'hour', type: 'int' })
  hour: number;

  @Column({ name: 'minute', type: 'int' })
  minute: number;

  @Column({ type: 'varchar', length: 128 })
  timezone: string;

  @Column({ name: 'remind_before_minutes', type: 'int' })
  remindBeforeMinutes: number;

  @Index()
  @Column({
    type: 'enum',
    enum: ReminderSeriesStatus,
    default: ReminderSeriesStatus.Active,
  })
  status: ReminderSeriesStatus;

  @OneToMany(() => Reminder, (reminder) => reminder.series)
  reminders: Reminder[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
