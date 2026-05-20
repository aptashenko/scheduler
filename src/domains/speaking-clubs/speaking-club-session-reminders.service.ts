import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { ClubSession } from './entities/club-session.entity';
import { SessionReminder, SessionReminderType } from './entities/session-reminder.entity';
import {
  ClubSessionStatus,
  SessionBookingStatus,
} from './entities/speaking-club.enums';
import { SpeakingClubTelegramService } from './telegram/speaking-club-telegram.service';

@Injectable()
export class SpeakingClubSessionRemindersService {
  private readonly logger = new Logger(SpeakingClubSessionRemindersService.name);

  constructor(
    @InjectRepository(ClubSession)
    private readonly sessionsRepository: Repository<ClubSession>,
    @InjectRepository(SessionReminder)
    private readonly remindersRepository: Repository<SessionReminder>,
    private readonly telegramService: SpeakingClubTelegramService,
  ) {}

  @Cron('* * * * *')
  async sendThirtyMinuteReminders() {
    const now = new Date();
    const from = new Date(now.getTime() + 29 * 60_000);
    const to = new Date(now.getTime() + 31 * 60_000);
    const sessions = await this.sessionsRepository.find({
      where: {
        status: ClubSessionStatus.Scheduled,
        startAt: Between(from, to),
      },
      relations: {
        club: true,
        teacher: { user: true },
        bookings: { student: { user: true } },
      },
    });

    for (const session of sessions) {
      await this.sendSessionReminders(session);
    }
  }

  private async sendSessionReminders(session: ClubSession) {
    await this.sendTeacherReminder(session);

    const confirmedBookings = (session.bookings ?? []).filter(
      (booking) => booking.status === SessionBookingStatus.Confirmed,
    );
    for (const booking of confirmedBookings) {
      await this.sendStudentReminder(session, booking);
    }
  }

  private async sendTeacherReminder(session: ClubSession) {
    const telegramId = session.teacher.telegramUserId;
    const inserted = await this.createReminder(session, telegramId);
    if (!inserted) {
      return;
    }

    const confirmedCount = (session.bookings ?? []).filter(
      (booking) => booking.status === SessionBookingStatus.Confirmed,
    ).length;
    await this.telegramService.sendMessage(
      telegramId,
      [
        'Your speaking club starts in 30 minutes',
        '',
        session.club.title,
        this.formatDate(session.startAt, session.teacher.user?.timezone ?? session.timezone),
        `Booked students: ${confirmedCount}`,
      ].join('\n'),
    );
  }

  private async sendStudentReminder(session: ClubSession, booking) {
    const telegramId = booking.student.telegramUserId;
    const inserted = await this.createReminder(session, telegramId);
    if (!inserted) {
      return;
    }

    const lines = [
      'Your speaking club starts in 30 minutes',
      '',
      session.club.title,
      this.formatDate(
        session.startAt,
        booking.student.user?.timezone ?? booking.student.timezone ?? session.timezone,
      ),
    ];
    if (booking.uniqueZoomUrl) {
      lines.push('', booking.uniqueZoomUrl);
    }

    await this.telegramService.sendMessage(telegramId, lines.join('\n'));
  }

  private async createReminder(session: ClubSession, recipientTelegramId: string) {
    const result = await this.remindersRepository
      .createQueryBuilder()
      .insert()
      .values({
        session,
        recipientTelegramId,
        type: SessionReminderType.StartsIn30Minutes,
      })
      .orIgnore()
      .execute();

    return Boolean(result.identifiers.length);
  }

  private formatDate(date: Date, timeZone: string) {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(date));
  }
}
