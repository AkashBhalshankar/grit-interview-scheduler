"""Every message a student can receive, in one place. Mirrored 1:1 in frontend/src/domain/messages.js."""
from __future__ import annotations

from datetime import datetime, timedelta

from .rules import POLICY, fmt_date, fmt_dt


def _name(track: str, badge: str) -> str:
    return f"{track} {badge}"


def booking_confirmed(track, badge, starts_at: datetime, interviewer: str):
    cutoff = fmt_dt(starts_at - timedelta(hours=POLICY.cancel_cutoff_hours))
    return (
        "Interview booked",
        f"You're booked! Your {_name(track, badge)} interview is on {fmt_dt(starts_at)} with {interviewer}. "
        f"Your join link appears here {POLICY.join_opens_minutes} minutes before the start. Keep your camera on and carry a valid ID. "
        f"You can reschedule until {cutoff}.",
    )


def result_pass(track, badge):
    return (
        "You passed!",
        f"Cleared for takeoff! You passed the {_name(track, badge)} interview. "
        f"Your Miles and {badge} Badge are now on your dashboard.",
    )


def result_retake(track, badge, notes: str, retake_on: datetime):
    d = fmt_date(retake_on)
    return (
        "Retake later",
        f"Not a pass yet, but you're close. Your interviewer has asked for a retake on or after {d}. "
        f"Feedback: \"{notes}\" Your cleared skills stay safe. You can book a new slot from {d}, with a different interviewer.",
    )


def result_fail(track, badge, notes: str, retry_on: datetime, attempts_left: int):
    return (
        "Not cleared this time",
        f"You didn't clear the {_name(track, badge)} interview this time. Feedback: \"{notes}\" "
        f"Your cleared skills stay safe. You can book again from {fmt_date(retry_on)}. Attempts left: {attempts_left}.",
    )


def slot_released(starts_at: datetime):
    return (
        "Your interview slot was cancelled",
        f"Your interviewer can't make the {fmt_dt(starts_at)} slot, so it has been cancelled. "
        f"This isn't your fault and it doesn't count as an attempt. Your booking is open again, so please pick a new slot.",
    )


def cancelled_by_student(starts_at: datetime):
    return ("Booking cancelled", f"Your {fmt_dt(starts_at)} interview is cancelled. You can book a new slot any time.")


def no_show(starts_at: datetime, retry_on: datetime):
    return (
        "Interview missed",
        f"You missed your {fmt_dt(starts_at)} interview. You can book again from {fmt_date(retry_on)}. "
        f"Repeated no-shows increase the wait.",
    )


def cooldown_over(track, badge):
    return ("You can book again", f"Your wait is over. Pick a new {_name(track, badge)} interview slot from your dashboard.")


def skills_completed(track, badge):
    return ("Interview unlocked", f"All skills for the {_name(track, badge)} Badge are cleared. Book your interview to claim it.")


def nullified(track, badge, reason: str):
    return (
        "Badge nullified",
        f"Your {_name(track, badge)} Badge and its Miles have been nullified after a malpractice review. "
        f"Reason: {reason}. If you think this is a mistake, contact the GRIT team within 7 days.",
    )


def on_hold(track, badge):
    return (
        "Interview on hold",
        f"Your {_name(track, badge)} interview is on hold while the GRIT team reviews your account. "
        f"Any booked slot has been released. The team will contact you.",
    )


def reinstated(track, badge):
    return ("Hold lifted", f"The review is complete and your hold is lifted. You can book your {_name(track, badge)} interview again.")


def overturned(track, badge):
    return ("Badge restored", f"Your appeal was upheld. Your {_name(track, badge)} Badge and Miles are restored.")


def reminder(track, badge, open_slots: int):
    return (
        "Time to book your interview",
        f"You've cleared every skill for the {_name(track, badge)} Badge. The last step is a quick interview, "
        f"and {open_slots} slots are open this week. Book one from your dashboard.",
    )


def skill_invalidated(track, badge, skill: str):
    return (
        "Interview on pause",
        f"A result for {skill} changed, so the {_name(track, badge)} interview is paused. "
        f"Any booked slot has been released. Clear the skill again to unlock your interview.",
    )
