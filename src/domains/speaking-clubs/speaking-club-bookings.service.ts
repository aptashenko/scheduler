import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { BookSessionDto } from './dto/book-session.dto';
import { ClubSession } from './entities/club-session.entity';
import { Payment } from './entities/payment.entity';
import { SessionBooking } from './entities/session-booking.entity';
import {
  PaymentStatus,
  SessionBookingPaymentStatus,
  SessionBookingStatus,
} from './entities/speaking-club.enums';
import { StudentProfile } from './entities/student-profile.entity';
import { SpeakingClubPaymentService } from './speaking-club-payment.service';
import { SpeakingClubZoomService } from './speaking-club-zoom.service';
import { SpeakingClubsService } from './speaking-clubs.service';

@Injectable()
export class SpeakingClubBookingsService {
  constructor(
    @InjectRepository(SessionBooking)
    private readonly bookingsRepository: Repository<SessionBooking>,
    @InjectRepository(StudentProfile)
    private readonly studentProfilesRepository: Repository<StudentProfile>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    private readonly speakingClubsService: SpeakingClubsService,
    private readonly paymentService: SpeakingClubPaymentService,
    private readonly zoomService: SpeakingClubZoomService,
  ) {}

  async bookSession(dto: BookSessionDto) {
    if (!dto.telegramUserId) {
      throw new BadRequestException('telegramUserId is required');
    }

    const session = await this.speakingClubsService.findSessionForBooking(
      dto.sessionId,
    );
    const timezone = await this.speakingClubsService.getUserTimezone(
      dto.telegramUserId,
      dto.timezone ?? session.timezone,
    );
    const student = await this.speakingClubsService.ensureStudentProfile({
      telegramUserId: dto.telegramUserId,
      timezone,
      learningLanguages: [session.club.targetLanguage],
    });

    const existing = await this.bookingsRepository.findOne({
      where: { session: { id: session.id }, student: { id: student.id } },
    });
    if (existing) {
      throw new BadRequestException('Student is already booked for this session');
    }

    const reservedCount = await this.bookingsRepository.count({
      where: [
        {
          session: { id: session.id },
          status: SessionBookingStatus.Confirmed,
        },
        {
          session: { id: session.id },
          status: SessionBookingStatus.PendingPayment,
        },
      ],
    });
    if (reservedCount >= session.club.capacity) {
      throw new BadRequestException('Session is full');
    }

    const booking = await this.bookingsRepository.save(
      this.bookingsRepository.create({
        session,
        student,
        status: session.club.isFree
          ? SessionBookingStatus.Confirmed
          : SessionBookingStatus.PendingPayment,
        paymentStatus: session.club.isFree
          ? SessionBookingPaymentStatus.Free
          : SessionBookingPaymentStatus.Pending,
        uniqueJoinToken: randomUUID(),
        uniqueZoomUrl: null,
        zoomRegistrantId: null,
        zoomRegistrantEmail: null,
        bookedAt: new Date(),
      }),
    );

    let savedBooking = booking;
    if (session.club.isFree) {
      try {
        savedBooking = await this.attachZoomRegistrant(session, booking);
      } catch (error) {
        await this.bookingsRepository.delete(booking.id);
        throw error;
      }
    }

    const paymentData = session.club.isFree
      ? this.paymentService.createFreePayment()
      : this.paymentService.createPaidPayment(savedBooking);

    const payment = await this.paymentsRepository.save(
      this.paymentsRepository.create({
        booking: savedBooking,
        student,
        teacher: session.teacher,
        amount: session.club.isFree ? 0 : session.club.price,
        currency: session.club.currency,
        provider: paymentData.provider,
        status: paymentData.status,
        externalPaymentId: paymentData.externalPaymentId,
      }),
    );

    return { booking: savedBooking, payment, session };
  }

  async confirmManualPayment(bookingId: number) {
    const booking = await this.bookingsRepository.findOne({
      where: { id: bookingId },
      relations: { session: true, student: true },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    booking.status = SessionBookingStatus.Confirmed;
    booking.paymentStatus = SessionBookingPaymentStatus.Paid;
    const savedBooking = await this.attachZoomRegistrant(booking.session, booking);

    const payment = await this.paymentsRepository.findOne({
      where: { booking: { id: booking.id } },
    });
    if (payment) {
      payment.status = PaymentStatus.Paid;
      await this.paymentsRepository.save(payment);
    }

    return savedBooking;
  }

  async listStudentBookings(telegramUserId: string) {
    const student = await this.studentProfilesRepository.findOne({
      where: { telegramUserId },
    });
    if (!student) {
      return [];
    }

    return this.bookingsRepository.find({
      where: { student: { id: student.id } },
      relations: { session: { club: true } },
      order: { bookedAt: 'DESC' },
    });
  }

  private async attachZoomRegistrant(
    session: ClubSession,
    booking: SessionBooking,
  ): Promise<SessionBooking> {
    if (booking.uniqueZoomUrl && booking.zoomRegistrantId) {
      return booking;
    }

    const registrant = await this.zoomService.registerBookingRegistrant(
      session,
      booking,
    );
    booking.uniqueZoomUrl = registrant.uniqueZoomUrl;
    booking.zoomRegistrantId = registrant.zoomRegistrantId;
    booking.zoomRegistrantEmail = registrant.zoomRegistrantEmail;
    return this.bookingsRepository.save(booking);
  }
}
