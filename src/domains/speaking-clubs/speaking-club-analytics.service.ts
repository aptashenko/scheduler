import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClubReview } from './entities/club-review.entity';
import { ClubSession } from './entities/club-session.entity';
import { Payment } from './entities/payment.entity';
import { SessionAttendance } from './entities/session-attendance.entity';
import { SessionBooking } from './entities/session-booking.entity';
import {
  PaymentStatus,
  SessionAttendanceStatus,
  SessionBookingStatus,
} from './entities/speaking-club.enums';
import { SpeakingClub } from './entities/speaking-club.entity';
import { SpeakingClubsService } from './speaking-clubs.service';

@Injectable()
export class SpeakingClubAnalyticsService {
  constructor(
    @InjectRepository(SpeakingClub)
    private readonly clubsRepository: Repository<SpeakingClub>,
    @InjectRepository(ClubSession)
    private readonly sessionsRepository: Repository<ClubSession>,
    @InjectRepository(SessionBooking)
    private readonly bookingsRepository: Repository<SessionBooking>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(SessionAttendance)
    private readonly attendanceRepository: Repository<SessionAttendance>,
    @InjectRepository(ClubReview)
    private readonly reviewsRepository: Repository<ClubReview>,
    private readonly speakingClubsService: SpeakingClubsService,
  ) {}

  async getTeacherAnalytics(telegramUserId: string) {
    const teacher = await this.speakingClubsService.getTeacherByTelegramId(
      telegramUserId,
    );
    if (!teacher) {
      return {
        totalStudents: 0,
        totalBookings: 0,
        totalRevenue: 0,
        averageFillRate: 0,
        attendanceRate: 0,
        noShowRate: 0,
        repeatStudentsCount: 0,
      };
    }

    const bookings = await this.bookingsRepository.find({
      where: { session: { teacher: { id: teacher.id } } },
      relations: { student: true, session: { club: true } },
    });
    const paidPayments = await this.paymentsRepository.find({
      where: {
        teacher: { id: teacher.id },
        status: PaymentStatus.Paid,
      },
    });
    const attendances = await this.attendanceRepository.find({
      where: { session: { teacher: { id: teacher.id } } },
    });
    const sessions = await this.sessionsRepository.find({
      where: { teacher: { id: teacher.id } },
      relations: { club: true },
    });

    const uniqueStudents = new Set(bookings.map((item) => item.student.id));
    const studentBookingCounts = bookings.reduce<Record<number, number>>(
      (acc, item) => {
        acc[item.student.id] = (acc[item.student.id] ?? 0) + 1;
        return acc;
      },
      {},
    );
    const confirmedBookings = bookings.filter(
      (item) => item.status !== SessionBookingStatus.Cancelled,
    );
    const capacity = sessions.reduce((sum, item) => sum + item.club.capacity, 0);
    const attended = attendances.filter(
      (item) => item.status === SessionAttendanceStatus.Attended,
    ).length;
    const noShows = attendances.filter(
      (item) => item.status === SessionAttendanceStatus.NoShow,
    ).length;

    return {
      totalStudents: uniqueStudents.size,
      totalBookings: confirmedBookings.length,
      totalRevenue: paidPayments.reduce((sum, item) => sum + item.amount, 0),
      averageFillRate: capacity ? confirmedBookings.length / capacity : 0,
      attendanceRate: attendances.length ? attended / attendances.length : 0,
      noShowRate: attendances.length ? noShows / attendances.length : 0,
      repeatStudentsCount: Object.values(studentBookingCounts).filter(
        (count) => count > 1,
      ).length,
    };
  }

  async getClubAnalytics(clubId: number) {
    const club = await this.clubsRepository.findOneBy({ id: clubId });
    if (!club) {
      return null;
    }

    const sessions = await this.sessionsRepository.find({
      where: { club: { id: club.id } },
    });
    const bookings = await this.bookingsRepository.find({
      where: { session: { club: { id: club.id } } },
    });
    const paidPayments = await this.paymentsRepository.find({
      where: {
        booking: { session: { club: { id: club.id } } },
        status: PaymentStatus.Paid,
      },
    });
    const attendances = await this.attendanceRepository.find({
      where: { session: { club: { id: club.id } } },
    });
    const reviews = await this.reviewsRepository.find({
      where: { club: { id: club.id } },
    });
    const noShows = attendances.filter(
      (item) => item.status === SessionAttendanceStatus.NoShow,
    ).length;

    return {
      sessionsCount: sessions.length,
      bookingsCount: bookings.length,
      averageParticipants: sessions.length ? bookings.length / sessions.length : 0,
      revenue: paidPayments.reduce((sum, item) => sum + item.amount, 0),
      noShowRate: attendances.length ? noShows / attendances.length : 0,
      averageRating: reviews.length
        ? reviews.reduce((sum, item) => sum + item.rating, 0) / reviews.length
        : 0,
    };
  }
}
