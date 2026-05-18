import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module';
import { ClubReview } from './entities/club-review.entity';
import { ClubSession } from './entities/club-session.entity';
import { Payment } from './entities/payment.entity';
import { SessionAttendance } from './entities/session-attendance.entity';
import { SessionBooking } from './entities/session-booking.entity';
import { SpeakingClub } from './entities/speaking-club.entity';
import { StudentProfile } from './entities/student-profile.entity';
import { TeacherProfile } from './entities/teacher-profile.entity';
import { SpeakingClubAnalyticsService } from './speaking-club-analytics.service';
import { SpeakingClubBookingsService } from './speaking-club-bookings.service';
import { SpeakingClubPaymentService } from './speaking-club-payment.service';
import { SpeakingClubZoomService } from './speaking-club-zoom.service';
import { SpeakingClubTelegramController } from './telegram/speaking-club-telegram.controller';
import { SpeakingClubTelegramService } from './telegram/speaking-club-telegram.service';
import { SpeakingClubsController } from './speaking-clubs.controller';
import { SpeakingClubsService } from './speaking-clubs.service';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([
      TeacherProfile,
      StudentProfile,
      SpeakingClub,
      ClubSession,
      SessionBooking,
      Payment,
      SessionAttendance,
      ClubReview,
    ]),
  ],
  controllers: [SpeakingClubsController, SpeakingClubTelegramController],
  providers: [
    SpeakingClubsService,
    SpeakingClubBookingsService,
    SpeakingClubAnalyticsService,
    SpeakingClubZoomService,
    SpeakingClubPaymentService,
    SpeakingClubTelegramService,
  ],
})
export class SpeakingClubsDomainModule {}
