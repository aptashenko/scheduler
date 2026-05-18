import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Users } from './entities/users.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Users)
    private readonly userRepository: Repository<Users>,
  ) {}

  async create(user: CreateUserDto) {
    await this.userRepository.upsert(user, ['telegramId']);
    return this.findUserById(user.telegramId);
  }

  findAll() {
    return this.userRepository.find();
  }

  async findUserById(id: string) {
    return this.userRepository.findOneByOrFail({ telegramId: id });
  }

  async findUserByUsername(username: string) {
    return this.userRepository.findOneByOrFail({ telegramName: username });
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
}
