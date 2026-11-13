import sys, pathlib
from datetime import datetime, timedelta, timezone
import pytest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app.rules import POLICY, RuleError, SlotCtx, StudentCtx, check_can_book, check_can_cancel, check_can_record, cooldown_until, slot_grid
from app.states import ALL_STATES, TRANSITIONS, allowed_events, next_state

NOW = datetime(2026, 11, 13, 5, 0, tzinfo=timezone.utc)
H = lambda n: NOW + timedelta(hours=n)  # noqa: E731
ok_student = StudentCtx("ELIGIBLE", "AI Product Mastery")
slot = lambda **k: SlotCtx(**{"status": "open", "starts_at": H(30), "interviewer_id": "iv1", "interviewer_tracks": ("AI Product Mastery",), **k})  # noqa: E731


def code(fn, *a):
    with pytest.raises(RuleError) as e:
        fn(*a)
    return e.value.code


def test_happy_path():
    check_can_book(ok_student, slot(), NOW, POLICY, set(), False)


@pytest.mark.parametrize("state,expect", [("NOT_ELIGIBLE", "NOT_ELIGIBLE"), ("BOOKED", "ALREADY_BOOKED"), ("PASSED", "ALREADY_PASSED"), ("NULLIFIED", "NULLIFIED"),
                                          ("ON_HOLD", "ON_HOLD"), ("FAILED", "COOLDOWN"), ("RETAKE_PENDING", "COOLDOWN")])
def test_student_gate(state, expect):
    assert code(check_can_book, StudentCtx(state, "AI Product Mastery", 1, H(48)), slot(), NOW, POLICY, set(), False) == expect


def test_max_attempts():
    assert code(check_can_book, StudentCtx("FAILED", "AI Product Mastery", POLICY.max_fails), slot(), NOW, POLICY, set(), False) == "MAX_ATTEMPTS"


def test_slot_rules():
    c = lambda s, **k: code(check_can_book, ok_student, s, NOW, POLICY, k.get("prior", set()), k.get("active", False))  # noqa: E731
    assert c(slot(status="booked")) == "SLOT_TAKEN"
    assert c(slot(starts_at=H(-1))) == "SLOT_PAST"
    assert c(slot(starts_at=H(5))) == "TOO_SOON"
    assert c(slot(interviewer_tracks=("AI Systems Mastery",))) == "TRACK_MISMATCH"
    assert c(slot(), prior={"iv1"}) == "SAME_INTERVIEWER"
    assert c(slot(), active=True) == "ALREADY_BOOKED"


def test_cancel_cutoff():
    check_can_cancel(H(7), NOW, POLICY, "student")
    assert code(check_can_cancel, H(5), NOW, POLICY, "student") == "CANCEL_TOO_LATE"
    check_can_cancel(H(1), NOW, POLICY, "interviewer")          # interviewer may always release
    assert code(check_can_cancel, H(-1), NOW, POLICY, "interviewer") == "ALREADY_STARTED"


def test_record_rules():
    assert code(check_can_record, H(1), NOW, "pass", None, None, POLICY) == "OUTCOME_TOO_EARLY"
    check_can_record(H(-1), NOW, "pass", None, None, POLICY)
    assert code(check_can_record, H(-1), NOW, "fail", "short", None, POLICY) == "NOTES_REQUIRED"
    assert code(check_can_record, H(-0.05), NOW, "no_show", None, None, POLICY) == "NOSHOW_TOO_EARLY"
    check_can_record(H(-0.5), NOW, "no_show", None, None, POLICY)
    assert code(check_can_record, H(-1), NOW, "pass", None, H(48), POLICY) == "BAD_RETAKE_DATE"
    assert code(check_can_record, H(-1), NOW, "retake", "needs more depth", H(1), POLICY) == "BAD_RETAKE_DATE"
    assert code(check_can_record, H(-1), NOW, "maybe", None, None, POLICY) == "BAD_OUTCOME"


def test_cooldowns():
    assert cooldown_until("pass", NOW, POLICY) is None
    assert cooldown_until("fail", NOW, POLICY) == NOW + timedelta(days=14)
    assert cooldown_until("no_show", NOW, POLICY, no_shows=2) == NOW + timedelta(days=6)


def test_slot_grid():
    ist = timezone(timedelta(hours=5, minutes=30)); s = datetime(2026, 11, 14, 10, 0, tzinfo=ist)
    assert len(slot_grid(s, s + timedelta(hours=2), NOW, POLICY)) == 4
    assert code(slot_grid, s, s - timedelta(hours=1), NOW, POLICY) == "BAD_RANGE"
    assert code(slot_grid, s + timedelta(minutes=10), s + timedelta(hours=2), NOW, POLICY) == "BAD_RANGE"
    assert code(slot_grid, s, s + timedelta(hours=13), NOW, POLICY) == "TOO_MANY_SLOTS"
    assert code(slot_grid, s.replace(day=1), s.replace(day=1) + timedelta(hours=1), NOW, POLICY) == "SLOT_PAST"


def test_state_table_is_closed_and_enforced():
    assert all(a in ALL_STATES and b in ALL_STATES for (a, _), b in TRANSITIONS.items())
    assert next_state("BOOKED", "PASS") == "PASSED"
    assert code(next_state, "PASSED", "BOOK") == "ILLEGAL_TRANSITION"
    assert code(next_state, "NULLIFIED", "PASS") == "ILLEGAL_TRANSITION"
    assert allowed_events("PASSED") == ["FLAG_MALPRACTICE"]
