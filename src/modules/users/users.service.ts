import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from './entities/user.entity';

type TelegramProfile = {
  telegramId: string;
  firstName?: string | null;
  username?: string | null;
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
      return this.usersRepository.save(existing);
    }

    const adminIds = (process.env.TELEGRAM_ADMIN_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    return this.usersRepository.save(
      this.usersRepository.create({
        telegramId: profile.telegramId,
        firstName: profile.firstName ?? null,
        username: profile.username ?? null,
        role: adminIds.includes(profile.telegramId) ? UserRole.Admin : UserRole.User,
      }),
    );
  }

  findByTelegramId(telegramId: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ telegramId });
  }
}
