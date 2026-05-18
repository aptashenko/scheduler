import { Injectable } from '@nestjs/common';
import { PaymentProvider, PaymentStatus } from './entities/speaking-club.enums';
import { SessionBooking } from './entities/session-booking.entity';

@Injectable()
export class SpeakingClubPaymentService {
  createFreePayment() {
    return {
      provider: PaymentProvider.Free,
      status: PaymentStatus.Paid,
      externalPaymentId: null,
    };
  }

  createPaidPayment(_booking: SessionBooking) {
    // TODO: Replace manual pending payment with Stripe checkout/session creation.
    return {
      provider: PaymentProvider.Manual,
      status: PaymentStatus.Pending,
      externalPaymentId: null,
    };
  }
}
