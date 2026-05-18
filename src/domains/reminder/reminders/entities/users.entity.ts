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

@Entity({ name: 'reminder_users', schema: DATABASE_SCHEMAS.reminder })
export class Users {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'telegram_id', type: 'bigint' })
  telegramId: string;

  @Column({
    name: 'telegram_name',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  telegramName: string | null;

  @OneToMany(() => Reminder, (reminder) => reminder.user)
  reminders: Reminder[];

  @Column({ name: 'timezone', type: 'varchar', length: 120, nullable: true })
  timezone: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
