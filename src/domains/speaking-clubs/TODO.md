# Speaking Clubs TODO

1. Connect real paid checkout instead of manual payment placeholder.
   - Current paid bookings use `MANUAL/PENDING`.
   - Stripe checkout is explicitly left as TODO in `speaking-club-payment.service.ts`.
   - Telegram `Pay` button only replies that Stripe is not connected yet.

2. Protect or remove manual payment confirmation endpoint.
   - `POST /speaking-clubs/bookings/:id/confirm-payment` confirms payment by booking id.
   - Add authorization/admin checks before this can be used outside local/manual testing.

3. Complete Zoom meeting lifecycle.
   - Meeting creation and registrant creation exist.
   - Participant reports/webhooks are still stubbed.
   - Meeting cancellation is still stubbed.

4. Implement attendance recording.
   - `SessionAttendance` entity exists and analytics reads it.
   - No service/API currently creates attendance records.
   - Use Zoom reports/webhooks or teacher-managed attendance.

5. Add cancellation and rescheduling flows.
   - Session and booking cancellation statuses exist.
   - There is no visible public flow for cancelling bookings, cancelling sessions, freeing seats, issuing refunds, or cancelling Zoom meetings.

6. Finish or remove Telegram MVP placeholders.
   - Student favorites are not implemented.
   - Teacher payouts are not connected.
   - Student payments/settings and teacher students/settings mostly return static text.

7. Add review creation flow.
   - `ClubReview` entity exists.
   - Analytics calculates average rating.
   - No API or Telegram flow currently creates validated reviews.

8. Strengthen DTO validation.
   - DTOs are plain classes without `class-validator` decorators.
   - Add validation for ids, timezone, currency, price minor units, enum values, and rating bounds.

9. Make capacity reservation concurrency-safe.
   - Booking currently counts reserved seats before saving.
   - Parallel booking requests can exceed capacity.
   - Use a transaction, lock, or database-backed capacity constraint.

10. Add speaking-clubs tests.
    - No `*.spec.ts` files exist under `src/domains/speaking-clubs`.
    - Cover booking capacity, duplicate bookings, free and paid payment states, manual payment confirmation, search filters, and teacher analytics.
