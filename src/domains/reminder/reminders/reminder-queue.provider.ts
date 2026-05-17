import { Logger } from '@nestjs/common';
import { Queue, QueueOptions } from 'bullmq';
import { REMINDER_QUEUE, REMINDER_QUEUE_TOKEN } from './constants';

const logger = new Logger('ReminderQueue');

export function createRedisConnection(): QueueOptions['connection'] {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
  };
}

export const reminderQueueProvider = {
  provide: REMINDER_QUEUE_TOKEN,
  useFactory: () => {
    const queue = new Queue(REMINDER_QUEUE, {
      connection: createRedisConnection(),
    });

    queue.on('error', (error) => {
      logger.error(
        `Redis is unavailable for reminder queue: ${error.message}`,
      );
    });

    return queue;
  },
};
