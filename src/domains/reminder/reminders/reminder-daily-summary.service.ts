import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { getDefaultTimeZone } from '../parser/strict-reminder-parser.service';
import { ReminderStatus } from './entities/reminder.entity';
import { RemindersService } from './reminders.service';
import { UsersService } from './users.service';
import { ReminderBotService } from '../telegram/reminder-bot.service';

@Injectable()
export class ReminderDailySummaryService {
  private readonly logger = new Logger(ReminderDailySummaryService.name);
  private readonly sentSummaryKeys = new Set<string>();

  constructor(
    private readonly remindersService: RemindersService,
    private readonly reminderBotService: ReminderBotService,
    private readonly usersService: UsersService,
  ) {}

  @Cron('* * * * *')
  async sendTodaySummary() {
    const users = await this.usersService.findAll();
    const reminders = (await this.remindersService.findAll()).filter(
      (reminder) => reminder.status === ReminderStatus.Pending,
    );

    for (const user of users) {
      const timeZone = getDefaultTimeZone(user);
      if (!this.isNineInUserTimeZone(timeZone)) {
        continue;
      }

      const summaryKey = `${user.telegramId}:${this.getDateKey(new Date(), timeZone)}`;
      if (this.sentSummaryKeys.has(summaryKey)) {
        continue;
      }

      const todaysReminders = reminders.filter(
        (reminder) =>
          reminder.telegramChatIds.includes(user.telegramId) &&
          this.isToday(reminder.remindAt, timeZone),
      );

      try {
        await this.reminderBotService.sendHtmlMessage(
          user.telegramId,
          this.formatTodaySummary(todaysReminders, timeZone),
        );
        this.sentSummaryKeys.add(summaryKey);
      } catch (error) {
        this.logger.error(
          `Failed to send daily reminder summary to ${user.telegramId}`,
          error,
        );
      }
    }
  }

  private formatTodaySummary(
    reminders: Array<{
      id: number;
      remindAt: Date;
      text: string;
    }>,
    timeZone: string,
  ) {
    if (reminders.length === 0) {
      return 'На сегодня ничего не запланировано';
    }

    return [
      '<b>Напоминания на сегодня</b>',
      '',
      ...reminders.map(
        (reminder, index) =>
          `${index + 1}. ${this.formatTime(reminder.remindAt, timeZone)} — ${this.escapeHtml(reminder.text)}`,
      ),
    ].join('\n');
  }

  private formatTime(date: Date, timeZone: string) {
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    });
  }

  private isToday(date: Date, timeZone: string) {
    return (
      this.getDateKey(date, timeZone) === this.getDateKey(new Date(), timeZone)
    );
  }

  private isNineInUserTimeZone(timeZone: string) {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      timeZone,
    }).formatToParts(new Date());
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );

    return values.hour === '09' && values.minute === '00';
  }

  private getDateKey(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );

    return `${values.year}-${values.month}-${values.day}`;
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
