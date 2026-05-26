import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReminderUserGroupMember, Users } from './entities/users.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Users)
    private readonly userRepository: Repository<Users>,
    @InjectRepository(ReminderUserGroupMember)
    private readonly groupMemberRepository: Repository<ReminderUserGroupMember>,
  ) {}

  async create(user: CreateUserDto) {
    await this.userRepository.upsert(user, ['telegramId']);
    return this.findUserById(user.telegramId);
  }

  findAll() {
    return this.userRepository.find();
  }

  count() {
    return this.userRepository.count();
  }

  async findUserById(id: string) {
    return this.userRepository.findOneByOrFail({ telegramId: id });
  }

  async findUserByUsername(username: string) {
    return this.userRepository.findOneByOrFail({ telegramName: username });
  }

  async addGroupMember(ownerTelegramId: string, username: string) {
    const normalizedUsername = this.normalizeTelegramUsername(username);
    if (!normalizedUsername) {
      throw new BadRequestException('Username is required');
    }

    const member = await this.userRepository.findOneBy({
      telegramName: normalizedUsername,
    });
    if (!member) {
      throw new NotFoundException('User not found');
    }
    if (member.telegramId === ownerTelegramId) {
      throw new BadRequestException('You cannot add yourself');
    }

    await this.groupMemberRepository.upsert(
      {
        ownerTelegramId,
        memberTelegramId: member.telegramId,
      },
      ['ownerTelegramId', 'memberTelegramId'],
    );

    return member;
  }

  async findGroupMembers(ownerTelegramId: string) {
    const members = await this.groupMemberRepository.find({
      where: { ownerTelegramId },
      order: { createdAt: 'ASC' },
    });
    const memberIds = members.map((member) => member.memberTelegramId);
    if (memberIds.length === 0) {
      return [];
    }

    const users = await this.userRepository.findBy(
      memberIds.map((telegramId) => ({ telegramId })),
    );
    const usersById = new Map(users.map((user) => [user.telegramId, user]));
    return memberIds
      .map((telegramId) => usersById.get(telegramId))
      .filter((user): user is Users => Boolean(user));
  }

  async getTimeZone(id: string) {
    const user = await this.findUserById(id);
    return user.timezone ?? null;
  }

  async updateTimezone(id: string, timezone: string) {
    const user = await this.findUserById(id);
    user.timezone = timezone;
    await this.userRepository.save(user);

    return user;
  }

  private normalizeTelegramUsername(value: string) {
    const username = value.trim();
    if (!username) {
      return '';
    }
    return username.startsWith('@') ? username : `@${username}`;
  }
}
