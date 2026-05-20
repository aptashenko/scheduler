export enum SpeakingClubLanguage {
  EN = 'EN',
  FR = 'FR',
  DE = 'DE',
  ES = 'ES',
  IT = 'IT',
  UA = 'UA',
  RU = 'RU',
  Other = 'OTHER',
}

export enum SpeakingClubLevel {
  A1 = 'A1',
  A2 = 'A2',
  B1 = 'B1',
  B2 = 'B2',
  C1 = 'C1',
}

export enum TeacherPayoutStatus {
  NotConfigured = 'NOT_CONFIGURED',
  Pending = 'PENDING',
  Active = 'ACTIVE',
  Blocked = 'BLOCKED',
}

export enum ClubSessionStatus {
  Scheduled = 'SCHEDULED',
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
}

export enum SessionBookingStatus {
  PendingPayment = 'PENDING_PAYMENT',
  Confirmed = 'CONFIRMED',
  Cancelled = 'CANCELLED',
  Attended = 'ATTENDED',
  NoShow = 'NO_SHOW',
}

export enum SessionBookingPaymentStatus {
  Free = 'FREE',
  Pending = 'PENDING',
  Paid = 'PAID',
  Failed = 'FAILED',
  Refunded = 'REFUNDED',
}

export enum PaymentProvider {
  Stripe = 'STRIPE',
  Manual = 'MANUAL',
  Free = 'FREE',
}

export enum PaymentStatus {
  Pending = 'PENDING',
  Paid = 'PAID',
  Failed = 'FAILED',
  Refunded = 'REFUNDED',
}

export enum SessionAttendanceStatus {
  Attended = 'ATTENDED',
  NoShow = 'NO_SHOW',
  Partial = 'PARTIAL',
}
