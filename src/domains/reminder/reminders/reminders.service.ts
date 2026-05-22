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
import {
  CreateReminderDto,
  ReminderRecurrenceDto,
} from './dto/create-reminder.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
import {
  ReminderRecurrenceFrequency,
  ReminderSeries,
  ReminderSeriesStatus,
} from './entities/reminder-series.entity';
import { Reminder, ReminderStatus } from './entities/reminder.entity';
import { dateTimeInDefaultTimeZoneToDate } from '../parser/strict-reminder-parser.service';

const REMIND_BEFORE_OPTIONS = [5, 10, 15, 30, 60];

@Injectable()
export class RemindersService implements OnModuleDestroy {
  constructor(
    @InjectRepository(Reminder)
    private readonly remindersRepository: Repository<Reminder>,
    @InjectRepository(ReminderSeries)
    private readonly reminderSeriesRepository: Repository<ReminderSeries>,
    @Inject(REMINDER_QUEUE_TOKEN)
    private readonly reminderQueue: Queue,
  ) {}

  async onModuleDestroy() {
    await this.reminderQueue.close();
  }

  async create(createReminderDto: CreateReminderDto) {
    this.assertCreateDto(createReminderDto);
    const eventAtValue =
      createReminderDto.eventAt ?? createReminderDto.remindAt;
    if (!eventAtValue) {
      throw new BadRequestException('eventAt is required');
    }
    const eventAt = this.parseRemindAt(eventAtValue);
    const remindBeforeMinutes = this.parseRemindBeforeMinutes(
      createReminderDto.remindBeforeMinutes,
    );
    const series = createReminderDto.recurrence
      ? await this.createSeries(
          createReminderDto,
          createReminderDto.recurrence,
          eventAt,
          remindBeforeMinutes,
        )
      : null;

    const reminder = await this.remindersRepository.save(
      this.remindersRepository.create({
        seriesId: series?.id ?? null,
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
          : this.parseRemindBeforeMinutes(
              updateReminderDto.remindBeforeMinutes,
            );
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
    await this.cancelSeries(reminder.seriesId);
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

    await this.detachSeriesChatId(reminder.seriesId, telegramChatId);
    return this.remindersRepository.save(reminder);
  }

  async scheduleNextSeriesOccurrence(reminder: Reminder) {
    if (!reminder.seriesId) {
      return null;
    }

    const series = await this.reminderSeriesRepository.findOneBy({
      id: reminder.seriesId,
      status: ReminderSeriesStatus.Active,
    });
    if (!series) {
      return null;
    }

    const eventAt = this.getNextSeriesEventAt(
      series,
      reminder.eventAt ?? reminder.remindAt,
    );
    const nextReminder = await this.remindersRepository.save(
      this.remindersRepository.create({
        eventAt,
        remindAt: eventAt,
        remindBeforeMinutes: series.remindBeforeMinutes,
        seriesId: series.id,
        status: ReminderStatus.Pending,
        telegramChatIds: series.telegramChatIds,
        text: series.text,
        userId: series.userId,
      }),
    );

    return this.scheduleReminder(nextReminder);
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

  private async createSeries(
    createReminderDto: CreateReminderDto,
    recurrence: ReminderRecurrenceDto,
    eventAt: Date,
    remindBeforeMinutes: number,
  ) {
    this.assertRecurrence(recurrence);
    const localTime = this.getTimeZoneDateParts(eventAt, recurrence.timezone);

    return this.reminderSeriesRepository.save(
      this.reminderSeriesRepository.create({
        dayOfMonth: recurrence.dayOfMonth ?? null,
        frequency: recurrence.frequency,
        hour: localTime.hour,
        minute: localTime.minute,
        remindBeforeMinutes,
        status: ReminderSeriesStatus.Active,
        telegramChatIds: createReminderDto.telegramChatIds,
        text: createReminderDto.text,
        timezone: recurrence.timezone,
        userId: createReminderDto.userId,
        weekday: recurrence.weekday ?? null,
      }),
    );
  }

  private async cancelSeries(seriesId: number | null) {
    if (!seriesId) {
      return;
    }

    await this.reminderSeriesRepository.update(seriesId, {
      status: ReminderSeriesStatus.Cancelled,
    });
  }

  private async detachSeriesChatId(
    seriesId: number | null,
    telegramChatId: string,
  ) {
    if (!seriesId) {
      return;
    }

    const series = await this.reminderSeriesRepository.findOneBy({
      id: seriesId,
    });
    if (!series || !series.telegramChatIds.includes(telegramChatId)) {
      return;
    }

    series.telegramChatIds = series.telegramChatIds.filter(
      (chatId) => chatId !== telegramChatId,
    );
    if (series.telegramChatIds.length === 0) {
      series.status = ReminderSeriesStatus.Cancelled;
    }
    await this.reminderSeriesRepository.save(series);
  }

  private assertRecurrence(recurrence: ReminderRecurrenceDto) {
    if (!recurrence.timezone?.trim()) {
      throw new BadRequestException('recurrence timezone is required');
    }

    if (
      recurrence.frequency !== ReminderRecurrenceFrequency.Weekly &&
      recurrence.frequency !== ReminderRecurrenceFrequency.Monthly
    ) {
      throw new BadRequestException('recurrence frequency is not supported');
    }

    const weekday = recurrence.weekday;
    if (
      recurrence.frequency === ReminderRecurrenceFrequency.Weekly &&
      (typeof weekday !== 'number' ||
        !Number.isInteger(weekday) ||
        weekday < 1 ||
        weekday > 7)
    ) {
      throw new BadRequestException('weekly recurrence weekday must be 1-7');
    }

    const dayOfMonth = recurrence.dayOfMonth;
    if (
      recurrence.frequency === ReminderRecurrenceFrequency.Monthly &&
      (typeof dayOfMonth !== 'number' ||
        !Number.isInteger(dayOfMonth) ||
        dayOfMonth < 1 ||
        dayOfMonth > 31)
    ) {
      throw new BadRequestException(
        'monthly recurrence dayOfMonth must be 1-31',
      );
    }
  }

  private getNextSeriesEventAt(series: ReminderSeries, currentEventAt: Date) {
    const current = this.getTimeZoneDateParts(currentEventAt, series.timezone);
    if (series.frequency === ReminderRecurrenceFrequency.Weekly) {
      const nextDate = new Date(
        Date.UTC(current.year, current.month - 1, current.day + 7),
      );
      return dateTimeInDefaultTimeZoneToDate(
        nextDate.getUTCFullYear(),
        nextDate.getUTCMonth() + 1,
        nextDate.getUTCDate(),
        series.hour,
        series.minute,
        { timezone: series.timezone },
      );
    }

    for (let monthOffset = 1; monthOffset <= 12; monthOffset += 1) {
      const nextDate = new Date(
        Date.UTC(
          current.year,
          current.month - 1 + monthOffset,
          series.dayOfMonth ?? 1,
        ),
      );
      const expectedMonth = new Date(
        Date.UTC(current.year, current.month - 1 + monthOffset, 1),
      ).getUTCMonth();
      if (nextDate.getUTCMonth() !== expectedMonth) {
        continue;
      }

      return dateTimeInDefaultTimeZoneToDate(
        nextDate.getUTCFullYear(),
        nextDate.getUTCMonth() + 1,
        nextDate.getUTCDate(),
        series.hour,
        series.minute,
        { timezone: series.timezone },
      );
    }

    throw new BadRequestException('Could not calculate next recurrence');
  }

  private getTimeZoneDateParts(date: Date, timeZone: string) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    });
    const values = Object.fromEntries(
      formatter
        .formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );

    return {
      day: values.day,
      hour: values.hour,
      minute: values.minute,
      month: values.month,
      year: values.year,
    };
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
