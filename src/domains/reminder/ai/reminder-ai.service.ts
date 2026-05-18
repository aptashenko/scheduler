import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';
import { getDefaultTimeZone } from '../parser/strict-reminder-parser.service';

export type ParsedReminder = {
  remindAt: string | null;
  text: string;
};

type UserTimeZone = { timezone?: string | null };

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
              text: { type: 'string' },
            },
            required: ['remindAt', 'text'],
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

    const parsed = JSON.parse(content) as ParsedReminder;
    return {
      remindAt: this.normalizeRemindAt(parsed.remindAt),
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
}
