import { StrictReminderParserService } from './strict-reminder-parser.service';

describe('StrictReminderParserService', () => {
  const service = new StrictReminderParserService();
  const now = new Date('2026-05-17T10:00:00+02:00');

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
});
