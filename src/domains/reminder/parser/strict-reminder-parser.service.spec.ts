import { StrictReminderParserService } from './strict-reminder-parser.service';

describe('StrictReminderParserService', () => {
  const service = new StrictReminderParserService();
  const now = new Date('2026-05-17T10:00:00+02:00');
  const defaultTimeZone = process.env.DEFAULT_TIMEZONE;

  beforeEach(() => {
    process.env.DEFAULT_TIMEZONE = 'Europe/Paris';
  });

  afterAll(() => {
    if (defaultTimeZone === undefined) {
      delete process.env.DEFAULT_TIMEZONE;
    } else {
      process.env.DEFAULT_TIMEZONE = defaultTimeZone;
    }
  });

  it('parses relative minutes', () => {
    const result = service.parse('Позвонить врачу через 5 минут', now);

    expect(result).toEqual({
      remindAt: new Date('2026-05-17T10:05:00+02:00').toISOString(),
      text: 'Позвонить врачу',
    });
  });

  it('parses tomorrow at time', () => {
    const result = service.parse('Позвонить врачу завтра в 14:00', now);

    expect(result).toEqual({
      remindAt: new Date('2026-05-18T14:00:00+02:00').toISOString(),
      text: 'Позвонить врачу',
    });
  });

  it('parses numeric date without year', () => {
    const result = service.parse('Позвонить врачу 18.05 в 10:30', now);

    expect(result).toEqual({
      remindAt: new Date('2026-05-18T10:30:00+02:00').toISOString(),
      text: 'Позвонить врачу',
    });
  });

  it('parses today at time in default timezone', () => {
    const result = service.parse(
      'Протестировать сегодня в 09:00',
      new Date('2026-05-17T08:00:00+02:00'),
    );

    expect(result).toEqual({
      remindAt: new Date('2026-05-17T09:00:00+02:00').toISOString(),
      text: 'Протестировать',
    });
  });

  it('parses ISO-like date time in default timezone', () => {
    const result = service.parse(
      'Протестировать 2026-05-17 09:00',
      new Date('2026-05-17T08:00:00+02:00'),
    );

    expect(result).toEqual({
      remindAt: new Date('2026-05-17T09:00:00+02:00').toISOString(),
      text: 'Протестировать',
    });
  });

  it('parses ISO-like date time in user timezone', () => {
    const result = service.parse(
      'Протестировать 2026-05-17 09:00',
      new Date('2026-05-17T06:00:00Z'),
      { timezone: 'Europe/Paris' },
    );

    expect(result).toEqual({
      remindAt: new Date('2026-05-17T09:00:00+02:00').toISOString(),
      text: 'Протестировать',
    });
  });
});
