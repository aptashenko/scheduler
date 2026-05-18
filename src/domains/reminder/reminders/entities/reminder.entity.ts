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
  @Column({ name: 'telegram_chat_ids', type: 'text', array: true })
  telegramChatIds: string[];

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

  @ManyToOne(() => Users, (user) => user.reminders, {
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'telegramId' })
  user: Users;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;
}
