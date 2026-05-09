import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Organization } from './organization.entity';

export enum OrganizationUserRole {
  User = 'USER',
  Admin = 'ADMIN',
}

@Entity('organization_users')
@Index(['organization', 'user'], { unique: true })
export class OrganizationUser {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, (organization) => organization.memberships, {
    nullable: false,
  })
  organization: Organization;

  @ManyToOne(() => User, (user) => user.organizationMemberships, {
    nullable: false,
  })
  user: User;

  @Column({
    type: 'enum',
    enum: OrganizationUserRole,
    default: OrganizationUserRole.User,
  })
  role: OrganizationUserRole;

  @CreateDateColumn()
  createdAt: Date;
}
