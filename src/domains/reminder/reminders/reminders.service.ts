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

const REMIND_BEFORE_OPTIONS = [5, 10, 15, 30, 60];

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
    const eventAtValue = createReminderDto.eventAt ?? createReminderDto.remindAt;
    if (!eventAtValue) {
      throw new BadRequestException('eventAt is required');
    }
    const eventAt = this.parseRemindAt(eventAtValue);
    const remindBeforeMinutes = this.parseRemindBeforeMinutes(
      createReminderDto.remindBeforeMinutes,
    );

    const reminder = await this.remindersRepository.save(
      this.remindersRepository.create({
        userId: createReminderDto.userId,
        telegramChatIds: createReminderDto.telegramChatIds,
        text: createReminderDto.text,
        remindAt: eventAt,
        eventAt,
        remindBeforeMinutes,
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
    const previousBeforeJobId = reminder.beforeBullJobId;

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
      const remindAt = this.parseRemindAt(updateReminderDto.remindAt);
      reminder.remindAt = remindAt;
      reminder.eventAt = remindAt;
    }
    if (updateReminderDto.eventAt !== undefined) {
      const eventAt = this.parseRemindAt(updateReminderDto.eventAt);
      reminder.eventAt = eventAt;
      reminder.remindAt = eventAt;
    }
    if (updateReminderDto.remindBeforeMinutes !== undefined) {
      reminder.remindBeforeMinutes =
        updateReminderDto.remindBeforeMinutes === null
          ? null
          : this.parseRemindBeforeMinutes(updateReminderDto.remindBeforeMinutes);
    }
    if (updateReminderDto.status !== undefined) {
      reminder.status = updateReminderDto.status;
    }

    if (reminder.status === ReminderStatus.Cancelled) {
      await this.removeJobs(previousJobId, previousBeforeJobId);
      reminder.bullJobId = null;
      reminder.beforeBullJobId = null;
      return this.remindersRepository.save(reminder);
    }

    if (reminder.status === ReminderStatus.Pending) {
      await this.removeJobs(previousJobId, previousBeforeJobId);
      reminder.bullJobId = null;
      reminder.beforeBullJobId = null;
      await this.remindersRepository.save(reminder);
      return this.scheduleReminder(reminder);
    }

    return this.remindersRepository.save(reminder);
  }

  async remove(id: number) {
    const reminder = await this.findOne(id);
    await this.removeJobs(reminder.bullJobId, reminder.beforeBullJobId);
    reminder.status = ReminderStatus.Cancelled;
    reminder.bullJobId = null;
    reminder.beforeBullJobId = null;
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
      await this.removeJobs(reminder.bullJobId, reminder.beforeBullJobId);
      reminder.status = ReminderStatus.Cancelled;
      reminder.bullJobId = null;
      reminder.beforeBullJobId = null;
    }

    return this.remindersRepository.save(reminder);
  }

  private async scheduleReminder(reminder: Reminder) {
    let beforeJobId: string | null = null;
    try {
      const eventAt = reminder.eventAt ?? reminder.remindAt;
      const beforeAt =
        reminder.remindBeforeMinutes === null ||
        reminder.remindBeforeMinutes === undefined
          ? null
          : new Date(
              eventAt.getTime() - reminder.remindBeforeMinutes * 60 * 1000,
            );

      const beforeJob =
        beforeAt === null
          ? null
          : await this.reminderQueue.add(
              SEND_REMINDER_JOB,
              { reminderId: reminder.id, type: 'before' },
              {
                attempts: 3,
                backoff: {
                  type: 'exponential',
                  delay: 30_000,
                },
                delay: this.getDelay(beforeAt),
                removeOnComplete: true,
                removeOnFail: false,
              },
            );
      beforeJobId = beforeJob?.id ?? null;
      const job = await this.reminderQueue.add(
        SEND_REMINDER_JOB,
        { reminderId: reminder.id, type: 'main' },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 30_000,
          },
          delay: this.getDelay(eventAt),
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      reminder.bullJobId = job.id ?? null;
      reminder.beforeBullJobId = beforeJobId;
      return this.remindersRepository.save(reminder);
    } catch (error) {
      await this.removeJob(beforeJobId);
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

  private async removeJobs(...jobIds: Array<string | null>) {
    for (const jobId of jobIds) {
      await this.removeJob(jobId);
    }
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

  private parseRemindBeforeMinutes(value: number | undefined) {
    if (!REMIND_BEFORE_OPTIONS.includes(Number(value))) {
      throw new BadRequestException(
        `remindBeforeMinutes must be one of: ${REMIND_BEFORE_OPTIONS.join(', ')}`,
      );
    }
    return Number(value);
  }

  private assertCreateDto(createReminderDto: CreateReminderDto) {
    if (!createReminderDto.userId) {
      throw new BadRequestException('userId is required');
    }
    if (!createReminderDto.telegramChatIds?.length) {
      throw new BadRequestException('telegramChatId is required');
    }
    if (!createReminderDto.text?.trim()) {
      throw new BadRequestException('text is required');
    }
    if (!createReminderDto.eventAt && !createReminderDto.remindAt) {
      throw new BadRequestException('eventAt is required');
    }
    if (createReminderDto.remindBeforeMinutes === undefined) {
      throw new BadRequestException('remindBeforeMinutes is required');
    }
  }
}
