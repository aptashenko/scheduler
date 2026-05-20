import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from './entities/user.entity';

type TelegramProfile = {
  telegramId: string;
  firstName?: string | null;
  username?: string | null;
  timezone?: string | null;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async upsertTelegramUser(profile: TelegramProfile): Promise<User> {
    const existing = await this.usersRepository.findOneBy({
      telegramId: profile.telegramId,
    });

    if (existing) {
      existing.firstName = profile.firstName ?? existing.firstName;
      existing.username = profile.username ?? existing.username;
      existing.timezone = profile.timezone ?? existing.timezone;
      return this.usersRepository.save(existing);
    }

    return this.usersRepository.save(
      this.usersRepository.create({
        telegramId: profile.telegramId,
        firstName: profile.firstName ?? null,
        username: profile.username ?? null,
        timezone: profile.timezone ?? null,
        role: UserRole.Student,
      }),
    );
  }

  findByTelegramId(telegramId: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ telegramId });
  }

  async setTimezone(telegramId: string, timezone: string): Promise<User> {
    const user = await this.upsertTelegramUser({ telegramId });
    user.timezone = timezone;
    return this.usersRepository.save(user);
  }
}
