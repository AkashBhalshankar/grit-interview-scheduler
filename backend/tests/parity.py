"""Builds docs/parity.json from the PYTHON rules. frontend/tests/parity.test.mjs replays the same calls in JS and
must produce identical strings, ids and transitions. Run `python tests/parity.py` after changing a message or rule."""
import json
import pathlib
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app import ai, messages as m, states  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parents[2] / "docs" / "parity.json"
T = "AI Product Mastery"
D = lambda y, mo, d, h, mi=0: int(datetime(y, mo, d, h, mi, tzinfo=timezone.utc).timestamp() * 1000)  # noqa: E731
START, RETRY = D(2026, 11, 20, 10, 30), D(2026, 12, 4, 6)
CALLS = [
    ("booking_confirmed", [T, "Novice", {"ms": START}, "Priya Nair"]),
    ("result_pass", [T, "Novice"]),
    ("result_retake", [T, "Novice", "Revisit prompt design and evaluation basics.", {"ms": RETRY}]),
    ("result_fail", [T, "Novice", "Revisit state management.", {"ms": RETRY}, 2]),
    ("slot_released", [{"ms": START}]), ("cancelled_by_student", [{"ms": START}]), ("no_show", [{"ms": START}, {"ms": RETRY}]),
    ("cooldown_over", [T, "Novice"]), ("skills_completed", [T, "Novice"]), ("nullified", [T, "Novice", "Answers were read from a second screen"]),
    ("on_hold", [T, "Novice"]), ("reinstated", [T, "Novice"]), ("overturned", [T, "Novice"]), ("reminder", [T, "Novice", 12]),
    ("skill_invalidated", [T, "Novice", "UI Engineering L2"]),
]
NOW = D(2026, 11, 13, 5)
SLOTS = [{"id": f"s{i}", "interviewer_id": iv, "starts_at": D(2026, 11, 14 + d, h)} for i, (iv, d, h) in enumerate(
    [("a", 0, 5), ("b", 0, 6), ("a", 1, 4), ("c", 1, 10), ("b", 2, 12), ("a", 3, 5), ("c", 3, 7)])]
LOAD = {"a": 5, "b": 1}


def _dt(v):
    return datetime.fromtimestamp(v["ms"] / 1000, tz=timezone.utc) if isinstance(v, dict) else v


def build():
    msgs = [{"fn": fn, "args": a, "out": list(getattr(m, fn)(*[_dt(x) for x in a]))} for fn, a in CALLS]
    sug = ai.suggest_slots([{**s, "starts_at": _dt({"ms": s["starts_at"]})} for s in SLOTS], _dt({"ms": NOW}), LOAD, 3)
    return {"messages": msgs, "transitions": sorted(f"{s}|{e}|{t}" for (s, e), t in states.TRANSITIONS.items()),
            "suggest": {"now": NOW, "slots": SLOTS, "load": LOAD, "out": sug}}


if __name__ == "__main__":
    OUT.write_text(json.dumps(build(), indent=1, ensure_ascii=False) + "\n")
    print("wrote", OUT)
