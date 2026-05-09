import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Event } from '../../events/entities/event.entity';
import { OrganizationUser } from './organization-user.entity';

export enum BotScenarioType {
  Scheduler = 'SCHEDULER',
}

export enum EventAnnouncementMode {
  Ask = 'ASK',
  Auto = 'AUTO',
  Off = 'OFF',
}

export type BotSettings = {
  menu: {
    eventsLabel: string;
    bookingsLabel: string;
    waitlistLabel: string;
    adminLabel: string;
    createEventLabel: string;
    myEventsLabel: string;
    backLabel: string;
    homeLabel: string;
  };
  texts: {
    welcome: string;
    confirmed: string;
    waitlistJoined: string;
    noActiveEvents: string;
  };
  features: {
    waitlist: boolean;
    reminders: boolean;
    eventAnnouncements: boolean;
  };
  eventAnnouncementMode: EventAnnouncementMode;
  inviteTimeoutMinutes: number;
};

export const defaultBotSettings: BotSettings = {
  menu: {
    eventsLabel: 'Events',
    bookingsLabel: 'My bookings',
    waitlistLabel: 'My waitlist',
    adminLabel: 'Admin',
    createEventLabel: 'Create event',
    myEventsLabel: 'My events',
    backLabel: 'Back',
    homeLabel: 'Home',
  },
  texts: {
    welcome: 'Welcome',
    confirmed: 'Booking confirmed',
    waitlistJoined: 'You joined the waitlist',
    noActiveEvents: 'No active events.',
  },
  features: {
    waitlist: true,
    reminders: true,
    eventAnnouncements: true,
  },
  eventAnnouncementMode: EventAnnouncementMode.Ask,
  inviteTimeoutMinutes: 15,
};

@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  slug: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  botToken: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  botUsername: string | null;

  @Column({
    type: 'enum',
    enum: BotScenarioType,
    default: BotScenarioType.Scheduler,
  })
  scenarioType: BotScenarioType;

  @Column({ type: 'jsonb', default: defaultBotSettings })
  settings: BotSettings;

  @OneToMany(() => Event, (event) => event.organization)
  events: Event[];

  @OneToMany(() => OrganizationUser, (membership) => membership.organization)
  memberships: OrganizationUser[];

  @CreateDateColumn()
  createdAt: Date;
}
