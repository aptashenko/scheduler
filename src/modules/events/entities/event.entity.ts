import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { Participant } from '../../participants/entities/participant.entity';
import { Waitlist } from '../../waitlist/entities/waitlist.entity';

export enum EventStatus {
  Active = 'ACTIVE',
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
}

@Entity('events')
export class Event {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Index()
  @Column({ type: 'timestamp' })
  startsAt: Date;

  @Column({ type: 'int' })
  capacity: number;

  @Column({ type: 'varchar', length: 80, default: 'General' })
  level: string;

  @Column({ type: 'varchar', length: 120 })
  teacher: string;

  @Column({ type: 'varchar', length: 500 })
  locationOrZoomLink: string;

  @Index()
  @Column({ type: 'enum', enum: EventStatus, default: EventStatus.Active })
  status: EventStatus;

  @Index()
  @ManyToOne(() => Organization, (organization) => organization.events, {
    nullable: false,
  })
  organization: Organization;

  @OneToMany(() => Participant, (participant) => participant.event)
  participants: Participant[];

  @OneToMany(() => Waitlist, (waitlist) => waitlist.event)
  waitlist: Waitlist[];

  @CreateDateColumn()
  createdAt: Date;
}
