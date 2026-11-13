"""Student interview journey: the single source of truth for allowed state changes.

Every service action calls next_state(); an illegal move raises RuleError, so the
database can never hold a state the table below does not allow.
"""
from __future__ import annotations

from .rules import RuleError

NOT_ELIGIBLE = "NOT_ELIGIBLE"      # skills for the badge not all cleared yet
ELIGIBLE = "ELIGIBLE"              # all skills cleared, may book
BOOKED = "BOOKED"                  # holds exactly one active slot
PASSED = "PASSED"                  # badge + Miles awarded
FAILED = "FAILED"                  # not cleared; cooldown, then a new attempt
RETAKE_PENDING = "RETAKE_PENDING"  # interviewer asked for a retake (or no-show); cooldown
NULLIFIED = "NULLIFIED"            # badge revoked after a malpractice flag
ON_HOLD = "ON_HOLD"                # malpractice flag before a badge exists; under review

ALL_STATES = (NOT_ELIGIBLE, ELIGIBLE, BOOKED, PASSED, FAILED, RETAKE_PENDING, NULLIFIED, ON_HOLD)

# (from_state, event) -> to_state
TRANSITIONS: dict[tuple[str, str], str] = {
    (NOT_ELIGIBLE, "SKILLS_COMPLETED"): ELIGIBLE,
    (ELIGIBLE, "BOOK"): BOOKED,
    (BOOKED, "CANCEL"): ELIGIBLE,             # student cancels, or interviewer releases the slot
    (BOOKED, "PASS"): PASSED,
    (BOOKED, "FAIL"): FAILED,
    (BOOKED, "RETAKE"): RETAKE_PENDING,
    (BOOKED, "NO_SHOW"): RETAKE_PENDING,
    (RETAKE_PENDING, "COOLDOWN_ELAPSED"): ELIGIBLE,
    (FAILED, "COOLDOWN_ELAPSED"): ELIGIBLE,   # only while fail_count < max_fails (service guard)
    # A skill result is invalidated later (contest malpractice, re-evaluation)
    (ELIGIBLE, "SKILL_INVALIDATED"): NOT_ELIGIBLE,
    (BOOKED, "SKILL_INVALIDATED"): NOT_ELIGIBLE,
    (RETAKE_PENDING, "SKILL_INVALIDATED"): NOT_ELIGIBLE,
    (FAILED, "SKILL_INVALIDATED"): NOT_ELIGIBLE,
    # Malpractice flagged later
    (PASSED, "FLAG_MALPRACTICE"): NULLIFIED,
    (NOT_ELIGIBLE, "FLAG_MALPRACTICE"): ON_HOLD,
    (ELIGIBLE, "FLAG_MALPRACTICE"): ON_HOLD,
    (BOOKED, "FLAG_MALPRACTICE"): ON_HOLD,
    (FAILED, "FLAG_MALPRACTICE"): ON_HOLD,
    (RETAKE_PENDING, "FLAG_MALPRACTICE"): ON_HOLD,
    # Team review outcomes
    (ON_HOLD, "REINSTATE"): ELIGIBLE,
    (NULLIFIED, "OVERTURN"): PASSED,          # appeal upheld, badge restored
}

EVENTS = tuple(sorted({e for (_, e) in TRANSITIONS}))


def next_state(state: str, event: str) -> str:
    try:
        return TRANSITIONS[(state, event)]
    except KeyError:
        raise RuleError(
            "ILLEGAL_TRANSITION",
            f"Cannot apply '{event}' while the student is {state}.",
            409,
        ) from None


def allowed_events(state: str) -> list[str]:
    return sorted(e for (s, e) in TRANSITIONS if s == state)
