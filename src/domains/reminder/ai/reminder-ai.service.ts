import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';
import { getDefaultTimeZone } from '../parser/strict-reminder-parser.service';
import { ReminderRecurrenceFrequency } from '../reminders/entities/reminder-series.entity';

export type ParsedReminderRecurrence = {
  dayOfMonth?: number;
  frequency: ReminderRecurrenceFrequency;
  timezone: string;
  weekday?: number;
};

export type ParsedReminder = {
  remindAt: string | null;
  recurrence?: ParsedReminderRecurrence | null;
  text: string;
};

type UserTimeZone = { timezone?: string | null };
type AiParsedReminderRecurrence = {
  dayOfMonth: number | null;
  frequency: ReminderRecurrenceFrequency;
  timezone: string;
  weekday: number | null;
};
type AiParsedReminder = Omit<ParsedReminder, 'recurrence'> & {
  recurrence: AiParsedReminderRecurrence | null;
};

@Injectable()
export class ReminderAiService {
  private readonly client?: OpenAI;

  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  isConfigured() {
    return Boolean(this.client);
  }

  async transcribeVoiceFromUrl(fileUrl: URL) {
    if (!this.client) {
      throw new ServiceUnavailableException('OPENAI_API_KEY is not configured');
    }

    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new ServiceUnavailableException(
        'Failed to download Telegram voice file',
      );
    }

    const audio = Buffer.from(await response.arrayBuffer());
    const transcription = await this.client.audio.transcriptions.create({
      file: await toFile(audio, 'voice.ogg', { type: 'audio/ogg' }),
      language: 'ru',
      model: process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-4o-mini-transcribe',
      prompt: 'Пользователь диктует короткое напоминание на русском языке.',
    });

    return transcription.text.trim();
  }

  async parseReminder(
    input: string,
    user?: UserTimeZone,
  ): Promise<ParsedReminder> {
    if (!this.client) {
      throw new ServiceUnavailableException('OPENAI_API_KEY is not configured');
    }

    const now = new Date();
    const timezone = getDefaultTimeZone(user);
    const completion = await this.client.chat.completions.create({
      model: process.env.OPENAI_REMINDER_PARSE_MODEL ?? 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: [
            'Ты парсер напоминаний на русском языке.',
            'Верни только JSON по схеме.',
            'Извлеки текст задачи и дату/время напоминания.',
            'Если дата или время не указаны или неоднозначны, remindAt должен быть null.',
            'remindAt должен быть ISO 8601 datetime с timezone offset.',
            'Для повторений заполни recurrence: weekly weekday 1-7 где 1 это понедельник, или monthly dayOfMonth 1-31.',
            'Для recurrence верни timezone пользователя и remindAt первого будущего повторения.',
            'Если у повторения не указано время, remindAt должен быть null и recurrence должен быть null.',
            'Не добавляй в text слова с датой и временем.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            `Текущее время: ${now.toISOString()}`,
            `Timezone пользователя: ${timezone}`,
            `Фраза: ${input}`,
          ].join('\n'),
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'parsed_reminder',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              remindAt: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
              },
              recurrence: {
                anyOf: [
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      dayOfMonth: {
                        anyOf: [{ type: 'number' }, { type: 'null' }],
                      },
                      frequency: {
                        enum: [
                          ReminderRecurrenceFrequency.Weekly,
                          ReminderRecurrenceFrequency.Monthly,
                        ],
                        type: 'string',
                      },
                      timezone: { type: 'string' },
                      weekday: {
                        anyOf: [{ type: 'number' }, { type: 'null' }],
                      },
                    },
                    required: [
                      'dayOfMonth',
                      'frequency',
                      'timezone',
                      'weekday',
                    ],
                  },
                  { type: 'null' },
                ],
              },
              text: { type: 'string' },
            },
            required: ['remindAt', 'recurrence', 'text'],
          },
          strict: true,
        },
      },
      temperature: 0,
    });

    const content = completion.choices[0]?.message.content;
    if (!content) {
      throw new ServiceUnavailableException('Failed to parse reminder text');
    }

    const parsed = JSON.parse(content) as AiParsedReminder;
    const remindAt = this.normalizeRemindAt(parsed.remindAt);
    return {
      remindAt,
      recurrence: remindAt ? this.normalizeRecurrence(parsed.recurrence) : null,
      text: parsed.text.trim(),
    };
  }

  private normalizeRemindAt(value: string | null) {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      return null;
    }

    return date.toISOString();
  }

  private normalizeRecurrence(
    recurrence: AiParsedReminderRecurrence | null,
  ): ParsedReminderRecurrence | null {
    if (!recurrence) {
      return null;
    }

    return {
      ...(recurrence.dayOfMonth === null
        ? {}
        : { dayOfMonth: recurrence.dayOfMonth }),
      frequency: recurrence.frequency,
      timezone: recurrence.timezone,
      ...(recurrence.weekday === null ? {} : { weekday: recurrence.weekday }),
    };
  }
}
