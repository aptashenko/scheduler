import { Injectable } from '@nestjs/common';
import { ParsedReminder, ReminderAiService } from '../ai/reminder-ai.service';
import { StrictReminderParserService } from './strict-reminder-parser.service';

export type ReminderParseResult = ParsedReminder & {
  source: 'strict' | 'ai' | 'none';
};

@Injectable()
export class ReminderParserService {
  constructor(
    private readonly reminderAiService: ReminderAiService,
    private readonly strictReminderParserService: StrictReminderParserService,
  ) {}

  async parse(input: string): Promise<ReminderParseResult> {
    const strictResult = this.strictReminderParserService.parse(input);
    if (strictResult?.remindAt) {
      return {
        ...strictResult,
        source: 'strict',
      };
    }

    if (!this.reminderAiService.isConfigured()) {
      return {
        remindAt: null,
        source: 'none',
        text: input.trim(),
      };
    }

    const aiResult = await this.reminderAiService.parseReminder(input);
    return {
      ...aiResult,
      source: aiResult.remindAt ? 'ai' : 'none',
    };
  }
}
