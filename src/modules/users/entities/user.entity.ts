import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrganizationUser } from '../../organizations/entities/organization-user.entity';
import { Participant } from '../../participants/entities/participant.entity';
import { Waitlist } from '../../waitlist/entities/waitlist.entity';

export enum UserRole {
  User = 'USER',
  Admin = 'ADMIN',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'bigint' })
  telegramId: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  username: string | null;

  @Index()
  @Column({ type: 'enum', enum: UserRole, default: UserRole.User })
  role: UserRole;

  @OneToMany(() => Participant, (participant) => participant.user)
  participants: Participant[];

  @OneToMany(() => Waitlist, (waitlist) => waitlist.user)
  waitlist: Waitlist[];

  @OneToMany(() => OrganizationUser, (membership) => membership.user)
  organizationMemberships: OrganizationUser[];

  @CreateDateColumn()
  createdAt: Date;
}
