"""Pure business rules (no database, no framework): easy to test, shared by every endpoint."""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
OUTCOMES = ("pass", "fail", "retake", "no_show")


class RuleError(Exception):
    """A business-rule violation. `code` is stable for the UI; `message` is human readable."""

    def __init__(self, code: str, message: str, status: int = 409):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _env_int(name: str, default: int) -> int:
    return int(os.getenv(name, default))


@dataclass(frozen=True)
class Policy:
    slot_minutes: int = _env_int("SLOT_MINUTES", 30)
    min_lead_hours: int = _env_int("MIN_LEAD_HOURS", 12)            # cannot book a slot starting sooner
    cancel_cutoff_hours: int = _env_int("CANCEL_CUTOFF_HOURS", 6)   # student cannot cancel inside this
    retake_cooldown_days: int = _env_int("RETAKE_COOLDOWN_DAYS", 7)
    fail_cooldown_days: int = _env_int("FAIL_COOLDOWN_DAYS", 14)
    no_show_cooldown_days: int = _env_int("NO_SHOW_COOLDOWN_DAYS", 3)  # multiplied by no-show count
    max_fails: int = _env_int("MAX_FAILS", 3)                       # after this the team must override
    outcome_overdue_hours: int = _env_int("OUTCOME_OVERDUE_HOURS", 24)
    no_show_grace_minutes: int = _env_int("NO_SHOW_GRACE_MINUTES", 10)
    max_slots_per_request: int = _env_int("MAX_SLOTS_PER_REQUEST", 24)
    notes_min_chars: int = 10
    join_opens_minutes: int = 15                                    # join link becomes visible this long before start
    reminder_throttle_hours: int = 24                               # team can nudge a student once per this window


POLICY = Policy()


@dataclass(frozen=True)
class StudentCtx:
    state: str
    track: str
    fail_count: int = 0
    next_eligible_at: datetime | None = None


@dataclass(frozen=True)
class SlotCtx:
    status: str
    starts_at: datetime
    interviewer_id: str
    interviewer_tracks: tuple[str, ...]


def fmt_dt(dt: datetime) -> str:
    """'Thu 13 Nov, 4:00 PM IST' (no platform-specific strftime flags)."""
    d = dt.astimezone(IST)
    hour = d.hour % 12 or 12
    return f"{d:%a} {d.day} {d:%b}, {hour}:{d:%M} {'AM' if d.hour < 12 else 'PM'} IST"


def fmt_date(dt: datetime) -> str:
    d = dt.astimezone(IST)
    return f"{d.day} {d:%b}"


def check_can_book(student: StudentCtx, slot: SlotCtx, now: datetime, policy: Policy,
                   prior_interviewer_ids: set[str], has_active_booking: bool) -> None:
    """Raises RuleError with a specific code for the first rule broken."""
    s = student.state
    if has_active_booking or s == "BOOKED":
        raise RuleError("ALREADY_BOOKED", "You already have an interview booked. Cancel it first to pick another slot.")
    if s == "ON_HOLD":
        raise RuleError("ON_HOLD", "Your interview is on hold while the GRIT team reviews your account.", 403)
    if s == "NULLIFIED":
        raise RuleError("NULLIFIED", "This badge was nullified, so it cannot be booked.", 403)
    if s == "PASSED":
        raise RuleError("ALREADY_PASSED", "You have already cleared this badge interview.")
    if s == "NOT_ELIGIBLE":
        raise RuleError("NOT_ELIGIBLE", "Clear every skill level for this badge to unlock the interview.", 403)
    if s in ("FAILED", "RETAKE_PENDING"):
        if s == "FAILED" and student.fail_count >= policy.max_fails:
            raise RuleError("MAX_ATTEMPTS", "You have used all interview attempts for this badge. Please contact the GRIT team.", 403)
        when = fmt_date(student.next_eligible_at) if student.next_eligible_at else "the cooldown date"
        raise RuleError("COOLDOWN", f"You can book again from {when}.")
    if s != "ELIGIBLE":
        raise RuleError("WRONG_STATE", f"Booking is not available while you are {s}.")

    if slot.status != "open":
        raise RuleError("SLOT_TAKEN", "Someone just took this slot. Please pick another one.")
    if slot.starts_at <= now:
        raise RuleError("SLOT_PAST", "This slot has already started.")
    if slot.starts_at < now + timedelta(hours=policy.min_lead_hours):
        raise RuleError("TOO_SOON", f"Slots must be booked at least {policy.min_lead_hours} hours ahead.")
    if student.track not in slot.interviewer_tracks:
        raise RuleError("TRACK_MISMATCH", "This interviewer does not assess your track.")
    if slot.interviewer_id in prior_interviewer_ids:
        raise RuleError("SAME_INTERVIEWER", "For a fair retake, please pick a different interviewer.")


def check_can_cancel(starts_at: datetime, now: datetime, policy: Policy, by: str) -> None:
    if starts_at <= now:
        raise RuleError("ALREADY_STARTED", "This interview has already started.")
    if by == "student" and starts_at - now < timedelta(hours=policy.cancel_cutoff_hours):
        raise RuleError(
            "CANCEL_TOO_LATE",
            f"Changes close {policy.cancel_cutoff_hours} hours before the interview. Please contact your interviewer.",
        )


def check_can_record(starts_at: datetime, now: datetime, outcome: str, notes: str | None,
                     retake_after: datetime | None, policy: Policy) -> None:
    if outcome not in OUTCOMES:
        raise RuleError("BAD_OUTCOME", f"Outcome must be one of {', '.join(OUTCOMES)}.", 422)
    if outcome == "no_show":
        if now < starts_at + timedelta(minutes=policy.no_show_grace_minutes):
            raise RuleError("NOSHOW_TOO_EARLY", f"Wait {policy.no_show_grace_minutes} minutes after the start before marking a no-show.")
    elif now < starts_at:
        raise RuleError("OUTCOME_TOO_EARLY", "You can record the outcome once the interview has started.")
    if outcome in ("fail", "retake") and len((notes or "").strip()) < policy.notes_min_chars:
        raise RuleError("NOTES_REQUIRED", f"Add feedback of at least {policy.notes_min_chars} characters so the student knows what to improve.", 422)
    if retake_after is not None:
        if outcome != "retake":
            raise RuleError("BAD_RETAKE_DATE", "A retake date only applies to a retake outcome.", 422)
        if not (now + timedelta(days=1) <= retake_after <= now + timedelta(days=60)):
            raise RuleError("BAD_RETAKE_DATE", "Retake date must be between 1 and 60 days from now.", 422)


def cooldown_until(outcome: str, now: datetime, policy: Policy, no_shows: int = 1,
                   retake_after: datetime | None = None) -> datetime | None:
    if outcome == "fail":
        return now + timedelta(days=policy.fail_cooldown_days)
    if outcome == "retake":
        return retake_after or now + timedelta(days=policy.retake_cooldown_days)
    if outcome == "no_show":
        return now + timedelta(days=policy.no_show_cooldown_days * max(1, no_shows))
    return None


def slot_grid(start: datetime, end: datetime, now: datetime, policy: Policy) -> list[datetime]:
    """Slot start times between start and end on the fixed grid. Validates the request."""
    m = policy.slot_minutes
    if start.tzinfo is None or end.tzinfo is None:
        raise RuleError("BAD_RANGE", "Times must include a timezone.", 422)
    if end <= start:
        raise RuleError("BAD_RANGE", "End time must be after the start time.", 422)
    if start.second or start.microsecond or start.minute % m:
        raise RuleError("BAD_RANGE", f"Start time must be on a {m}-minute mark.", 422)
    if start <= now:
        raise RuleError("SLOT_PAST", "Availability must start in the future.", 422)
    starts, t = [], start
    while t + timedelta(minutes=m) <= end:
        starts.append(t)
        t += timedelta(minutes=m)
    if not starts:
        raise RuleError("BAD_RANGE", f"The window must fit at least one {m}-minute slot.", 422)
    if len(starts) > policy.max_slots_per_request:
        raise RuleError("TOO_MANY_SLOTS", f"Add at most {policy.max_slots_per_request} slots at a time.", 422)
    return starts
