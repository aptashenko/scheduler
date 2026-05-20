import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
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

  @Column({ name: 'first_name', type: 'varchar', length: 120, nullable: true })
  firstName: string | null;

  @Column({ name: 'last_name', type: 'varchar', length: 120, nullable: true })
  lastName: string | null;

  @OneToMany(() => Reminder, (reminder) => reminder.user)
  reminders: Reminder[];

  @Column({ name: 'timezone', type: 'varchar', length: 120, nullable: true })
  timezone: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity({
  name: 'reminder_user_group_members',
  schema: DATABASE_SCHEMAS.reminder,
})
@Index(['ownerTelegramId', 'memberTelegramId'], { unique: true })
export class ReminderUserGroupMember {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'owner_telegram_id', type: 'bigint' })
  ownerTelegramId: string;

  @Index()
  @Column({ name: 'member_telegram_id', type: 'bigint' })
  memberTelegramId: string;

  @ManyToOne(() => Users, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'owner_telegram_id', referencedColumnName: 'telegramId' })
  owner: Users;

  @ManyToOne(() => Users, { createForeignKeyConstraints: false })
  @JoinColumn({
    name: 'member_telegram_id',
    referencedColumnName: 'telegramId',
  })
  member: Users;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
