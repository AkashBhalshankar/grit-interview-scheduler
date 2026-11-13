-- GRIT Interview Scheduling: reference schema (PostgreSQL; also runs on SQLite for tests).
-- Timestamps are stored in UTC. ids are app-generated text ids (prefix_random).

CREATE TABLE students (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL UNIQUE,
  batch            INTEGER NOT NULL,
  track            TEXT NOT NULL,                 -- e.g. 'AI Product Mastery'
  badge            TEXT NOT NULL,                 -- e.g. 'Novice'
  state            TEXT NOT NULL DEFAULT 'NOT_ELIGIBLE'
                   CHECK (state IN ('NOT_ELIGIBLE','ELIGIBLE','BOOKED','PASSED','FAILED',
                                    'RETAKE_PENDING','NULLIFIED','ON_HOLD')),
  fail_count       INTEGER NOT NULL DEFAULT 0,
  no_shows         INTEGER NOT NULL DEFAULT 0,
  next_eligible_at TIMESTAMPTZ,                   -- end of cooldown after fail / retake / no-show
  badge_awarded_at TIMESTAMPTZ,
  nullified_at     TIMESTAMPTZ,
  state_reason     TEXT,                          -- malpractice reason for ON_HOLD / NULLIFIED
  created_at       TIMESTAMPTZ NOT NULL
);

-- Skill levels a badge needs. Written by the contest system; read-only here.
CREATE TABLE student_skills (
  student_id TEXT NOT NULL REFERENCES students(id),
  skill      TEXT NOT NULL,
  level      TEXT NOT NULL,                       -- 'L1'..'L4'
  cleared    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (student_id, skill, level)
);

CREATE TABLE interviewers (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);

-- Which tracks an interviewer is qualified to assess.
CREATE TABLE interviewer_tracks (
  interviewer_id TEXT NOT NULL REFERENCES interviewers(id),
  track          TEXT NOT NULL,
  PRIMARY KEY (interviewer_id, track)
);

CREATE TABLE slots (
  id             TEXT PRIMARY KEY,
  interviewer_id TEXT NOT NULL REFERENCES interviewers(id),
  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','booked','cancelled')),
  created_at     TIMESTAMPTZ NOT NULL,
  CHECK (ends_at > starts_at),
  -- An interviewer cannot publish the same start twice. Slots sit on a fixed 30-minute
  -- grid, so equal starts are the only way two of their slots can overlap.
  -- (Postgres alternative for variable lengths: EXCLUDE USING gist
  --  (interviewer_id WITH =, tstzrange(starts_at, ends_at) WITH &&).)
  UNIQUE (interviewer_id, starts_at)
);
CREATE INDEX ix_slots_open ON slots (starts_at) WHERE status = 'open';

CREATE TABLE bookings (
  id           TEXT PRIMARY KEY,
  slot_id      TEXT NOT NULL REFERENCES slots(id),
  student_id   TEXT NOT NULL REFERENCES students(id),
  badge        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','completed','no_show',
                                 'cancelled_by_student','cancelled_by_interviewer','cancelled_by_team')),
  meet_link    TEXT,
  created_at   TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ
);

-- THE double-booking guard. Two partial unique indexes, enforced by the database itself:
--   1) a slot can have at most one ACTIVE booking
--   2) a student can have at most one ACTIVE booking per badge
-- Cancelled / completed rows are history and do not block a re-booking of the same slot.
CREATE UNIQUE INDEX uq_booking_active_slot    ON bookings (slot_id)            WHERE status = 'active';
CREATE UNIQUE INDEX uq_booking_active_student ON bookings (student_id, badge)  WHERE status = 'active';

-- One recorded result per booking.
CREATE TABLE interviews (
  id             TEXT PRIMARY KEY,
  booking_id     TEXT NOT NULL UNIQUE REFERENCES bookings(id),
  interviewer_id TEXT NOT NULL REFERENCES interviewers(id),
  outcome        TEXT NOT NULL CHECK (outcome IN ('pass','fail','retake','no_show')),
  notes          TEXT,
  retake_after   TIMESTAMPTZ,
  recorded_at    TIMESTAMPTZ NOT NULL,
  recorded_by    TEXT NOT NULL
);

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  read_at    TIMESTAMPTZ
);
CREATE INDEX ix_notifications_student ON notifications (student_id, created_at);

CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL,
  actor_role TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  detail     TEXT
);
