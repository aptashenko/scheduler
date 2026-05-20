ALTER TABLE IF EXISTS speaking_clubs.speaking_club_session_bookings
  ADD COLUMN IF NOT EXISTS "zoomRegistrantId" varchar(200),
  ADD COLUMN IF NOT EXISTS "zoomRegistrantEmail" varchar(320);

CREATE UNIQUE INDEX IF NOT EXISTS "IDX_speaking_club_booking_zoom_registrant"
  ON speaking_clubs.speaking_club_session_bookings ("zoomRegistrantId")
  WHERE "zoomRegistrantId" IS NOT NULL;
