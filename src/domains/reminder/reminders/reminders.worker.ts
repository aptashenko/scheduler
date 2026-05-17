import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Worker } from 'bullmq';
import { Repository } from 'typeorm';
import { ReminderBotService } from '../telegram/reminder-bot.service';
import { REMINDER_QUEUE, SEND_REMINDER_JOB } from './constants';
import { Reminder, ReminderStatus } from './entities/reminder.entity';
import { createRedisConnection } from './reminder-queue.provider';

type SendReminderJob = {
  reminderId: number;
};

@Injectable()
export class RemindersWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersWorker.name);
  private worker?: Worker<SendReminderJob>;

  constructor(
    @InjectRepository(Reminder)
    private readonly remindersRepository: Repository<Reminder>,
    private readonly reminderBotService: ReminderBotService,
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
      this.logger.log(`Reminder ${reminder.id} skipped with status ${reminder.status}`);
      return;
    }

    try {
      await this.reminderBotService.sendMessage(
        reminder.telegramChatId,
        reminder.text,
      );

      reminder.status = ReminderStatus.Sent;
      reminder.sentAt = new Date();
      await this.remindersRepository.save(reminder);
    } catch (error) {
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= attempts) {
        reminder.status = ReminderStatus.Failed;
        await this.remindersRepository.save(reminder);
      }
      throw error;
    }
  }
}
