import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Event } from '../../events/entities/event.entity';
import { User } from '../../users/entities/user.entity';

export enum WaitlistStatus {
  Waiting = 'WAITING',
  Invited = 'INVITED',
  Accepted = 'ACCEPTED',
  Declined = 'DECLINED',
  Expired = 'EXPIRED',
}

@Entity('waitlist')
@Index(['event', 'user'])
@Index(['event', 'status', 'position'])
export class Waitlist {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Event, (event) => event.waitlist, { nullable: false })
  event: Event;

  @ManyToOne(() => User, (user) => user.waitlist, { nullable: false })
  user: User;

  @Column({
    type: 'enum',
    enum: WaitlistStatus,
    default: WaitlistStatus.Waiting,
  })
  status: WaitlistStatus;

  @Column({ type: 'int' })
  position: number;

  @Column({ type: 'timestamp', nullable: true })
  invitedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
