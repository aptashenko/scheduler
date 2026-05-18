import { Injectable } from '@nestjs/common';
import { ParsedReminder } from '../ai/reminder-ai.service';

type DateMatch = {
  index: number;
  length: number;
  remindAt: Date;
};

type TimeZoneDateParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
};

type UserTimeZone = { timezone?: string | null };

export function getDefaultTimeZone(user?: { timezone?: string | null }) {
  if (user?.timezone) {
    return user.timezone;
  }
  return process.env.DEFAULT_TIMEZONE ?? 'Europe/Paris';
}

export function dateTimeInDefaultTimeZoneToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  user?: { timezone?: string | null },
) {
  return dateTimeInTimeZoneToDate(
    year,
    month,
    day,
    hour,
    minute,
    getDefaultTimeZone(user),
  );
}

@Injectable()
export class StrictReminderParserService {
  parse(
    input: string,
    now = new Date(),
    user?: UserTimeZone,
  ): ParsedReminder | null {
    const normalized = input.trim().replace(/\s+/g, ' ');
    if (!normalized) {
      return null;
    }

    const match =
      this.parseRelative(normalized, now) ??
      this.parseTodayTomorrow(normalized, now, user) ??
      this.parseNumericDate(normalized, now, user) ??
      this.parseIsoDate(normalized, user);

    if (!match || match.remindAt.getTime() <= now.getTime()) {
      return null;
    }

    return {
      remindAt: match.remindAt.toISOString(),
      text: this.cleanText(normalized, match),
    };
  }

  private parseRelative(input: string, now: Date): DateMatch | null {
    const match = input.match(
      /(?:^|\s)через\s+(\d{1,4})\s*(минут(?:у|ы)?|мин\.?|м|час(?:а|ов)?|ч)(?=\s|$)/i,
    );
    if (!match || match.index === undefined) {
      return null;
    }

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const remindAt = new Date(now);
    if (unit.startsWith('мин') || unit === 'м') {
      remindAt.setMinutes(remindAt.getMinutes() + amount);
    } else {
      remindAt.setHours(remindAt.getHours() + amount);
    }

    return this.toDateMatch(match, remindAt);
  }

  private parseTodayTomorrow(
    input: string,
    now: Date,
    user?: UserTimeZone,
  ): DateMatch | null {
    const match = input.match(
      /(?:^|\s)(сегодня|завтра|послезавтра)\s+(?:в\s+)?(\d{1,2})(?::(\d{2}))?(?=\s|$)/i,
    );
    if (!match || match.index === undefined) {
      return null;
    }

    const dayOffset =
      match[1].toLowerCase() === 'сегодня'
        ? 0
        : match[1].toLowerCase() === 'завтра'
          ? 1
          : 2;
    const nowParts = getTimeZoneDateParts(now, getDefaultTimeZone(user));
    const targetDate = new Date(
      Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + dayOffset),
    );
    const remindAt = dateTimeInDefaultTimeZoneToDate(
      targetDate.getUTCFullYear(),
      targetDate.getUTCMonth() + 1,
      targetDate.getUTCDate(),
      Number(match[2]),
      Number(match[3] ?? 0),
      user,
    );

    return this.toDateMatch(match, remindAt);
  }

  private parseNumericDate(
    input: string,
    now: Date,
    user?: UserTimeZone,
  ): DateMatch | null {
    const match = input.match(
      /(?:^|\s)(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\s+(?:в\s+)?(\d{1,2})(?::(\d{2}))?(?=\s|$)/i,
    );
    if (!match || match.index === undefined) {
      return null;
    }

    const nowParts = getTimeZoneDateParts(now, getDefaultTimeZone(user));
    const year = match[3]
      ? this.normalizeYear(Number(match[3]))
      : nowParts.year;
    const remindAt = dateTimeInDefaultTimeZoneToDate(
      year,
      Number(match[2]),
      Number(match[1]),
      Number(match[4]),
      Number(match[5] ?? 0),
      user,
    );

    if (!match[3] && remindAt.getTime() <= now.getTime()) {
      return this.toDateMatch(
        match,
        dateTimeInDefaultTimeZoneToDate(
          year + 1,
          Number(match[2]),
          Number(match[1]),
          Number(match[4]),
          Number(match[5] ?? 0),
          user,
        ),
      );
    }

    return this.toDateMatch(match, remindAt);
  }

  private parseIsoDate(input: string, user?: UserTimeZone): DateMatch | null {
    const match = input.match(
      /\b(\d{4}-\d{2}-\d{2})(?:[ T])(\d{1,2}):(\d{2})\b/,
    );
    if (!match || match.index === undefined) {
      return null;
    }

    return {
      index: match.index,
      length: match[0].length,
      remindAt: dateTimeInDefaultTimeZoneToDate(
        Number(match[1].slice(0, 4)),
        Number(match[1].slice(5, 7)),
        Number(match[1].slice(8, 10)),
        Number(match[2]),
        Number(match[3]),
        user,
      ),
    };
  }

  private cleanText(input: string, match: DateMatch) {
    return input
      .slice(0, match.index)
      .concat(input.slice(match.index + match.length))
      .replace(/\b(напомни|напомнить|мне|пожалуйста)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeYear(year: number) {
    return year < 100 ? 2000 + year : year;
  }

  private toDateMatch(match: RegExpMatchArray, remindAt: Date): DateMatch {
    const matchedText = match[0];
    const leadingWhitespace =
      matchedText.length - matchedText.trimStart().length;

    return {
      index: (match.index ?? 0) + leadingWhitespace,
      length: matchedText.length - leadingWhitespace,
      remindAt,
    };
  }
}

function dateTimeInTimeZoneToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const utcTime = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstGuess = new Date(utcTime);
  const firstOffset = getTimeZoneOffset(firstGuess, timeZone);
  const secondGuess = new Date(utcTime - firstOffset);
  const secondOffset = getTimeZoneOffset(secondGuess, timeZone);

  return new Date(utcTime - secondOffset);
}

function getTimeZoneOffset(date: Date, timeZone: string) {
  const parts = getTimeZoneDateParts(date, timeZone);
  const timeZoneTime = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return timeZoneTime - date.getTime();
}

function getTimeZoneDateParts(date: Date, timeZone: string): TimeZoneDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  });
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    month: values.month,
    second: values.second,
    year: values.year,
  };
}
