declare module 'telegram-inline-calendar' {
  import { Telegraf } from 'telegraf';

  type CalendarOptions = {
    bot_api?: 'telegraf';
    close_calendar?: boolean;
    custom_start_msg?: string;
    date_format?: string;
    language?: string;
    start_date?: string;
    start_week_day?: number;
    stop_date?: string;
    time_range?: string;
    time_selector_mod?: boolean;
    time_step?: string;
  };

  export default class Calendar {
    chats: Map<number, number>;

    constructor(bot: Telegraf, options?: CalendarOptions);

    startNavCalendar(message: unknown): void;

    clickButtonCalendar(callbackQuery: unknown): string | -1;
  }
}
