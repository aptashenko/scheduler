import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ReminderStatus {
  Pending = 'pending',
  Sent = 'sent',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

@Entity('reminders')
export class Reminder {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Index()
  @Column({ name: 'telegram_chat_id', type: 'varchar', length: 64 })
  telegramChatId: string;

  @Column({ type: 'text' })
  text: string;

  @Index()
  @Column({ name: 'remind_at', type: 'timestamptz' })
  remindAt: Date;

  @Index()
  @Column({
    type: 'enum',
    enum: ReminderStatus,
    default: ReminderStatus.Pending,
  })
  status: ReminderStatus;

  @Column({ name: 'bull_job_id', type: 'varchar', length: 128, nullable: true })
  bullJobId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;
}
