import { Injectable } from '@nestjs/common';
import { ParsedReminder } from '../ai/reminder-ai.service';

type DateMatch = {
  index: number;
  length: number;
  remindAt: Date;
};

@Injectable()
export class StrictReminderParserService {
  parse(input: string, now = new Date()): ParsedReminder | null {
    const normalized = input.trim().replace(/\s+/g, ' ');
    if (!normalized) {
      return null;
    }

    const match =
      this.parseRelative(normalized, now) ??
      this.parseTodayTomorrow(normalized, now) ??
      this.parseNumericDate(normalized, now) ??
      this.parseIsoDate(normalized);

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

  private parseTodayTomorrow(input: string, now: Date): DateMatch | null {
    const match = input.match(
      /(?:^|\s)(сегодня|завтра|послезавтра)\s+(?:в\s+)?(\d{1,2})(?::(\d{2}))?(?=\s|$)/i,
    );
    if (!match || match.index === undefined) {
      return null;
    }

    const dayOffset = match[1].toLowerCase() === 'сегодня'
      ? 0
      : match[1].toLowerCase() === 'завтра'
        ? 1
        : 2;
    const remindAt = new Date(now);
    remindAt.setDate(remindAt.getDate() + dayOffset);
    remindAt.setHours(Number(match[2]), Number(match[3] ?? 0), 0, 0);

    return this.toDateMatch(match, remindAt);
  }

  private parseNumericDate(input: string, now: Date): DateMatch | null {
    const match = input.match(
      /(?:^|\s)(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\s+(?:в\s+)?(\d{1,2})(?::(\d{2}))?(?=\s|$)/i,
    );
    if (!match || match.index === undefined) {
      return null;
    }

    const year = match[3]
      ? this.normalizeYear(Number(match[3]))
      : now.getFullYear();
    const remindAt = new Date(
      year,
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4]),
      Number(match[5] ?? 0),
      0,
      0,
    );

    if (!match[3] && remindAt.getTime() <= now.getTime()) {
      remindAt.setFullYear(remindAt.getFullYear() + 1);
    }

    return this.toDateMatch(match, remindAt);
  }

  private parseIsoDate(input: string): DateMatch | null {
    const match = input.match(
      /\b(\d{4}-\d{2}-\d{2})(?:[ T])(\d{1,2}):(\d{2})\b/,
    );
    if (!match || match.index === undefined) {
      return null;
    }

    return {
      index: match.index,
      length: match[0].length,
      remindAt: new Date(`${match[1]}T${match[2].padStart(2, '0')}:${match[3]}:00`),
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
    const leadingWhitespace = matchedText.length - matchedText.trimStart().length;

    return {
      index: (match.index ?? 0) + leadingWhitespace,
      length: matchedText.length - leadingWhitespace,
      remindAt,
    };
  }
}
