import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  defaultBotSettings,
  Organization,
} from './entities/organization.entity';
import {
  OrganizationUser,
  OrganizationUserRole,
} from './entities/organization-user.entity';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationsRepository: Repository<Organization>,
    @InjectRepository(OrganizationUser)
    private readonly organizationUsersRepository: Repository<OrganizationUser>,
  ) {}

  findOne(id: number): Promise<Organization | null> {
    return this.organizationsRepository.findOneBy({ id });
  }

  findAll(): Promise<Organization[]> {
    return this.organizationsRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async create(input: {
    name: string;
    slug: string;
    botToken: string;
    botUsername?: string | null;
    settings?: Partial<typeof defaultBotSettings>;
  }): Promise<Organization> {
    return this.organizationsRepository.save(
      this.organizationsRepository.create({
        name: input.name,
        slug: input.slug,
        botToken: input.botToken,
        botUsername: input.botUsername ?? null,
        settings: this.mergeSettings(input.settings),
      }),
    );
  }

  async updateSettings(
    id: number,
    settings: Partial<typeof defaultBotSettings>,
  ): Promise<Organization> {
    const organization = await this.findOneOrFail(id);
    organization.settings = this.mergeSettings({
      ...organization.settings,
      ...settings,
      menu: {
        ...organization.settings.menu,
        ...(settings.menu ?? {}),
      },
      texts: {
        ...organization.settings.texts,
        ...(settings.texts ?? {}),
      },
      features: {
        ...organization.settings.features,
        ...(settings.features ?? {}),
      },
    });
    return this.organizationsRepository.save(organization);
  }

  async findOneOrFail(id: number): Promise<Organization> {
    const organization = await this.findOne(id);
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    organization.settings = this.mergeSettings(organization.settings);
    return organization;
  }

  async findOrCreateDefault(): Promise<Organization | null> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return null;
    }

    const existing = await this.organizationsRepository.findOneBy({
      botToken: token,
    });
    if (existing) {
      existing.settings = this.mergeSettings(existing.settings);
      return existing;
    }

    return this.organizationsRepository.save(
      this.organizationsRepository.create({
        name: process.env.DEFAULT_ORGANIZATION_NAME ?? 'Default organization',
        slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? 'default',
        botToken: token,
        botUsername: process.env.TELEGRAM_BOT_USERNAME ?? null,
        settings: defaultBotSettings,
      }),
    );
  }

  async findOrCreateMembership(
    organization: Organization,
    user: User,
  ): Promise<OrganizationUser> {
    const existing = await this.organizationUsersRepository.findOne({
      where: {
        organization: { id: organization.id },
        user: { id: user.id },
      },
      relations: { organization: true, user: true },
    });

    if (existing) {
      return existing;
    }

    const adminIds = (process.env.TELEGRAM_ADMIN_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    return this.organizationUsersRepository.save(
      this.organizationUsersRepository.create({
        organization,
        user,
        role: adminIds.includes(user.telegramId)
          ? OrganizationUserRole.Admin
          : OrganizationUserRole.User,
      }),
    );
  }

  async listSubscriberTelegramIds(organizationId: number): Promise<string[]> {
    const memberships = await this.organizationUsersRepository.find({
      where: { organization: { id: organizationId } },
      relations: { user: true },
    });

    return memberships
      .map((membership) => membership.user.telegramId)
      .filter(Boolean);
  }

  private mergeSettings(settings): typeof defaultBotSettings {
    return {
      ...defaultBotSettings,
      ...(settings ?? {}),
      menu: {
        ...defaultBotSettings.menu,
        ...(settings?.menu ?? {}),
      },
      texts: {
        ...defaultBotSettings.texts,
        ...(settings?.texts ?? {}),
      },
      features: {
        ...defaultBotSettings.features,
        ...(settings?.features ?? {}),
      },
    };
  }
}
