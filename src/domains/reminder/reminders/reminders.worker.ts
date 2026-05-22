import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Worker } from 'bullmq';
import { Repository } from 'typeorm';
import { ReminderBotService } from '../telegram/reminder-bot.service';
import { REMINDER_QUEUE, SEND_REMINDER_JOB } from './constants';
import { Reminder, ReminderStatus } from './entities/reminder.entity';
import { createRedisConnection } from './reminder-queue.provider';
import { RemindersService } from './reminders.service';

type SendReminderJob = {
  reminderId: number;
  type?: 'before' | 'main';
};

@Injectable()
export class RemindersWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersWorker.name);
  private worker?: Worker<SendReminderJob>;

  constructor(
    @InjectRepository(Reminder)
    private readonly remindersRepository: Repository<Reminder>,
    private readonly reminderBotService: ReminderBotService,
    private readonly remindersService: RemindersService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<SendReminderJob>(
      REMINDER_QUEUE,
      (job) => this.process(job),
      {
        connection: createRedisConnection(),
      },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error(`Reminder job ${job?.id ?? 'unknown'} failed`, error);
    });
    this.worker.on('error', (error) => {
      this.logger.error(
        `Redis is unavailable for reminder worker: ${error.message}`,
      );
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async process(job: Job<SendReminderJob>) {
    if (job.name !== SEND_REMINDER_JOB) {
      return;
    }

    const reminder = await this.remindersRepository.findOneBy({
      id: job.data.reminderId,
    });
    if (!reminder) {
      this.logger.warn(`Reminder ${job.data.reminderId} not found`);
      return;
    }

    if (reminder.status !== ReminderStatus.Pending) {
      this.logger.log(
        `Reminder ${reminder.id} skipped with status ${reminder.status}`,
      );
      return;
    }

    const jobType = job.data.type ?? 'main';

    try {
      for (const telegramChatId of reminder.telegramChatIds) {
        await this.reminderBotService.sendMessage(
          telegramChatId,
          this.getReminderMessage(reminder, jobType),
        );
      }

      if (jobType === 'before') {
        reminder.beforeSentAt = new Date();
      } else {
        reminder.status = ReminderStatus.Sent;
        reminder.sentAt = new Date();
      }
      await this.remindersRepository.save(reminder);
      if (jobType === 'main' && reminder.seriesId) {
        try {
          await this.remindersService.scheduleNextSeriesOccurrence(reminder);
        } catch (error) {
          this.logger.error(
            `Failed to schedule next occurrence for reminder series ${reminder.seriesId}`,
            error,
          );
        }
      }
    } catch (error) {
      const attempts = job.opts.attempts ?? 1;
      if (jobType === 'main' && job.attemptsMade + 1 >= attempts) {
        reminder.status = ReminderStatus.Failed;
        await this.remindersRepository.save(reminder);
      }
      throw error;
    }
  }

  private getReminderMessage(reminder: Reminder, jobType: 'before' | 'main') {
    if (
      jobType !== 'before' ||
      reminder.remindBeforeMinutes === null ||
      reminder.remindBeforeMinutes === undefined
    ) {
      return reminder.text;
    }

    return [
      `In ${reminder.remindBeforeMinutes} minutes`,
      '',
      reminder.text,
    ].join('\n');
  }
}
