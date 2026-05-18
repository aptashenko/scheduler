import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { REMINDER_QUEUE_TOKEN, SEND_REMINDER_JOB } from './constants';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
import { Reminder, ReminderStatus } from './entities/reminder.entity';

@Injectable()
export class RemindersService implements OnModuleDestroy {
  constructor(
    @InjectRepository(Reminder)
    private readonly remindersRepository: Repository<Reminder>,
    @Inject(REMINDER_QUEUE_TOKEN)
    private readonly reminderQueue: Queue,
  ) {}

  async onModuleDestroy() {
    await this.reminderQueue.close();
  }

  async create(createReminderDto: CreateReminderDto) {
    this.assertCreateDto(createReminderDto);

    const reminder = await this.remindersRepository.save(
      this.remindersRepository.create({
        userId: createReminderDto.userId,
        telegramChatIds: createReminderDto.telegramChatIds,
        text: createReminderDto.text,
        remindAt: this.parseRemindAt(createReminderDto.remindAt),
        status: ReminderStatus.Pending,
      }),
    );

    return this.scheduleReminder(reminder);
  }

  findAll() {
    return this.remindersRepository.find({
      order: { remindAt: 'ASC' },
    });
  }

  async findOne(id: number) {
    const reminder = await this.remindersRepository.findOneBy({ id });
    if (!reminder) {
      throw new NotFoundException('Reminder not found');
    }
    return reminder;
  }

  async update(id: number, updateReminderDto: UpdateReminderDto) {
    const reminder = await this.findOne(id);
    const previousJobId = reminder.bullJobId;

    if (updateReminderDto.userId !== undefined) {
      reminder.userId = updateReminderDto.userId;
    }
    if (updateReminderDto.telegramChatIds !== undefined) {
      reminder.telegramChatIds = updateReminderDto.telegramChatIds;
    }
    if (updateReminderDto.text !== undefined) {
      reminder.text = updateReminderDto.text;
    }
    if (updateReminderDto.remindAt !== undefined) {
      reminder.remindAt = this.parseRemindAt(updateReminderDto.remindAt);
    }
    if (updateReminderDto.status !== undefined) {
      reminder.status = updateReminderDto.status;
    }

    if (reminder.status === ReminderStatus.Cancelled) {
      await this.removeJob(previousJobId);
      reminder.bullJobId = null;
      return this.remindersRepository.save(reminder);
    }

    if (reminder.status === ReminderStatus.Pending) {
      await this.removeJob(previousJobId);
      reminder.bullJobId = null;
      await this.remindersRepository.save(reminder);
      return this.scheduleReminder(reminder);
    }

    return this.remindersRepository.save(reminder);
  }

  async remove(id: number) {
    const reminder = await this.findOne(id);
    await this.removeJob(reminder.bullJobId);
    reminder.status = ReminderStatus.Cancelled;
    reminder.bullJobId = null;
    return this.remindersRepository.save(reminder);
  }

  async detachChatId(id: number, telegramChatId: string) {
    const reminder = await this.findOne(id);
    if (!reminder.telegramChatIds.includes(telegramChatId)) {
      return reminder;
    }

    reminder.telegramChatIds = reminder.telegramChatIds.filter(
      (chatId) => chatId !== telegramChatId,
    );

    if (reminder.telegramChatIds.length === 0) {
      await this.removeJob(reminder.bullJobId);
      reminder.status = ReminderStatus.Cancelled;
      reminder.bullJobId = null;
    }

    return this.remindersRepository.save(reminder);
  }

  private async scheduleReminder(reminder: Reminder) {
    try {
      const job = await this.reminderQueue.add(
        SEND_REMINDER_JOB,
        { reminderId: reminder.id },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 30_000,
          },
          delay: this.getDelay(reminder.remindAt),
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      reminder.bullJobId = job.id ?? null;
      return this.remindersRepository.save(reminder);
    } catch (error) {
      reminder.status = ReminderStatus.Failed;
      await this.remindersRepository.save(reminder);
      throw new ServiceUnavailableException(
        'Redis is unavailable. Reminder was not scheduled.',
      );
    }
  }

  private async removeJob(jobId: string | null) {
    if (!jobId) {
      return;
    }

    const job = await Job.fromId(this.reminderQueue, jobId);
    await job?.remove();
  }

  private parseRemindAt(value: string) {
    const remindAt = new Date(value);
    if (Number.isNaN(remindAt.getTime())) {
      throw new BadRequestException('remindAt must be a valid ISO date');
    }
    return remindAt;
  }

  private getDelay(remindAt: Date) {
    return Math.max(remindAt.getTime() - Date.now(), 0);
  }

  private assertCreateDto(createReminderDto: CreateReminderDto) {
    if (!createReminderDto.userId) {
      throw new BadRequestException('userId is required');
    }
    if (!createReminderDto.telegramChatIds.length) {
      throw new BadRequestException('telegramChatId is required');
    }
    if (!createReminderDto.text?.trim()) {
      throw new BadRequestException('text is required');
    }
    if (!createReminderDto.remindAt) {
      throw new BadRequestException('remindAt is required');
    }
  }
}
