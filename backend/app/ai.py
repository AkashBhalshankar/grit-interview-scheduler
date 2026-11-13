"""AI bonus. Two helpers, and neither can change a booking:

1. suggest_slots(): deterministic, explainable ranking of open slots ("Recommended for you").
   Pure scoring, so it is testable and cannot hallucinate a slot that does not exist.
2. draft_reminder(): drafts the team's nudge to eligible students. Uses Claude when
   ANTHROPIC_API_KEY is set, and falls back to the fixed template otherwise.
"""
from __future__ import annotations

from datetime import datetime

from . import messages
from .config import settings
from .rules import IST


def score_slot(starts_at: datetime, now: datetime, interviewer_load: int) -> tuple[float, list[str]]:
    hours = (starts_at - now).total_seconds() / 3600
    score, reasons = 0.0, []
    score += max(0.0, 40 - (hours / 24) * 8)          # sooner is better; the badge deadline is Dec 2026
    local = starts_at.astimezone(IST)
    if 10 <= local.hour < 18:
        score += 20
        reasons.append("Daytime slot (10 AM to 6 PM)")
    elif local.hour in (9, 18):
        score += 10
    score += max(0.0, 15 - 3 * interviewer_load)      # spread load, shorter waits for everyone
    if interviewer_load <= 2:
        reasons.append("Interviewer has a light schedule")
    return score, reasons


def suggest_slots(slots: list[dict], now: datetime, load_by_interviewer: dict[str, int], k: int = 3) -> list[dict]:
    """slots: [{id, interviewer_id, starts_at(datetime)}]. Returns top k with reasons."""
    if not slots:
        return []
    earliest = min(s["starts_at"] for s in slots)
    ranked = []
    for s in slots:
        sc, reasons = score_slot(s["starts_at"], now, load_by_interviewer.get(s["interviewer_id"], 0))
        if s["starts_at"] == earliest:
            reasons = ["Earliest available"] + reasons
        ranked.append({"slot_id": s["id"], "score": round(sc, 2), "reasons": reasons or ["Open slot"], "_t": s["starts_at"]})
    ranked.sort(key=lambda r: (-r["score"], r["_t"]))
    out = []
    seen_interviewers: set[str] = set()
    by_id = {s["id"]: s for s in slots}
    for r in ranked:                                   # prefer variety: one pick per interviewer first
        iv = by_id[r["slot_id"]]["interviewer_id"]
        if iv in seen_interviewers:
            continue
        seen_interviewers.add(iv)
        out.append({k_: v for k_, v in r.items() if k_ != "_t"})
        if len(out) == k:
            return out
    for r in ranked:
        if len(out) == k:
            break
        if all(o["slot_id"] != r["slot_id"] for o in out):
            out.append({k_: v for k_, v in r.items() if k_ != "_t"})
    return out


SYSTEM = (
    "You write short, warm, specific notifications for NIAT students in the GRIT programme. "
    "Two or three sentences, plain language, no emojis, no exclamation marks beyond one. "
    "Never invent dates, numbers or links. Use only the facts you are given."
)


def draft_reminder(track: str, badge: str, open_slots: int, first_name: str | None = None) -> dict:
    """Returns {title, body, source} where source is 'ai' or 'template'."""
    title, body = messages.reminder(track, badge, open_slots)
    if settings.anthropic_api_key:
        try:
            import anthropic  # imported lazily so the app runs without the package

            client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
            prompt = (
                f"Write a reminder for {first_name or 'a student'} who has cleared every skill for the "
                f"{track} {badge} Badge but has not booked the interview yet. Facts: {open_slots} interview "
                f"slots are open this week; booking is on their GRIT dashboard. Base message to improve:\n{body}"
            )
            msg = client.messages.create(
                model=settings.anthropic_model, max_tokens=250, system=SYSTEM,
                messages=[{"role": "user", "content": prompt}],
            )
            text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
            if text:
                return {"title": title, "body": text, "source": "ai"}
        except Exception:  # network, quota, missing package: never block the team
            pass
    return {"title": title, "body": body, "source": "template"}
