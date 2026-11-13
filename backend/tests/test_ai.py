import sys, pathlib
from datetime import datetime, timedelta, timezone
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app import ai

NOW = datetime(2026, 11, 13, 5, 0, tzinfo=timezone.utc)


def test_suggestions_are_real_slots_with_reasons_and_variety():
    slots = [{"id": f"s{i}", "interviewer_id": iv, "starts_at": NOW + timedelta(hours=14 + i * 5)} for i, iv in enumerate("aabbc")]
    out = ai.suggest_slots(slots, NOW, {"a": 6}, 3)
    assert len(out) == 3 and {o["slot_id"] for o in out} <= {s["id"] for s in slots}
    assert len({next(s["interviewer_id"] for s in slots if s["id"] == o["slot_id"]) for o in out}) == 3   # one per interviewer first
    assert all(o["reasons"] for o in out)


def test_empty_and_template_fallback():
    assert ai.suggest_slots([], NOW, {}) == []
    r = ai.draft_reminder("AI Product Mastery", "Novice", 12, "Aarav")   # no API key in tests: must fall back, never raise
    assert r["source"] == "template" and "12 slots" in r["body"]
