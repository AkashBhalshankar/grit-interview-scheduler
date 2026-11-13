"""Demo data (invented names). `python -m app.seed` creates tables and loads it; DEMO_MODE exposes POST /api/demo/reset."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from . import messages
from .db import SessionLocal, engine
from .models import Base, Booking, Interview, Interviewer, InterviewerTrack, Notification, Slot, Student, StudentSkill
from .rules import IST, POLICY

TRACK, BADGE = "AI Product Mastery", "Novice"
SKILLS = [("Computational Thinking", "L1"), ("CS Fundamentals", "L1"), ("Applied Gen AI Development", "L1"), ("UI Engineering", "L2")]
WINDOWS = {"iv_priya": ([0, 1, 2, 3, 4, 5], [(10, 13), (15, 18)]), "iv_rahul": ([0, 1, 2, 3, 4], [(11, 14)]), "iv_sana": ([0, 1, 2, 3, 4], [(16, 20)])}


def reset_and_seed(db, now: datetime | None = None):
    Base.metadata.drop_all(engine); Base.metadata.create_all(engine); seed(db, now or datetime.now(timezone.utc)); db.commit()


def seed(db, now: datetime):
    today = now.astimezone(IST).replace(hour=0, minute=0, second=0, microsecond=0)
    at = lambda off, h, m=0: (today + timedelta(days=off, hours=h, minutes=m)).astimezone(timezone.utc)  # noqa: E731
    for iid, name, tracks in [("iv_priya", "Priya Nair", [TRACK, "AI Systems Mastery"]), ("iv_rahul", "Rahul Verma", [TRACK]), ("iv_sana", "Sana Qureshi", [TRACK, "AI Models Mastery"])]:
        db.add(Interviewer(id=iid, name=name, email=f"{iid[3:]}@interviews.example.com")); db.add_all(InterviewerTrack(interviewer_id=iid, track=t) for t in tracks)
    db.flush(); slots = {}

    def slot(iv, start, status="open"):
        k = (iv, start)
        if k not in slots:
            slots[k] = Slot(id=f"sl_{len(slots)}", interviewer_id=iv, starts_at=start, ends_at=start + timedelta(minutes=POLICY.slot_minutes), status=status, created_at=now - timedelta(days=20)); db.add(slots[k])
        return slots[k]

    for off in range(-3, 15):
        for iv, (dows, ranges) in WINDOWS.items():
            if (today + timedelta(days=off)).weekday() in dows:
                for a, b in ranges:
                    for i in range((b - a) * 2): slot(iv, at(off, a, 30 * i))
    n = [0]

    def student(sid, name, batch, state, cleared=4, **kw):
        db.add(Student(id=sid, name=name, email=f"{sid[4:]}@niat.example.com", batch=batch, track=TRACK, badge=BADGE, state=state, created_at=now - timedelta(days=60), **kw))
        db.add_all(StudentSkill(student_id=sid, skill=s, level=l, cleared=i < cleared) for i, (s, l) in enumerate(SKILLS))

    def note(sid, kind, msg, when): n[0] += 1; db.add(Notification(id=f"nt_{n[0]}", student_id=sid, kind=kind, title=msg[0], body=msg[1], created_at=when, read_at=when))

    def book(sid, iv, start, status):
        sl = slot(iv, start, "booked"); sl.status = "booked"; b = Booking(id=f"bk_{sid}", slot_id=sl.id, student_id=sid, badge=BADGE, status=status, created_at=now - timedelta(days=3), meet_link="https://meet.example.com/demo"); db.add(b); return b, sl

    def result(b, sl, outcome, notes=None):
        r = sl.ends_at + timedelta(minutes=5); db.add(Interview(id=f"in_{b.id}", booking_id=b.id, interviewer_id=sl.interviewer_id, outcome=outcome, notes=notes, recorded_at=r, recorded_by=sl.interviewer_id)); return r

    for sid, name, batch, days in [("stu_aarav", "Aarav Mehta", 2024, 2), ("stu_tanvi", "Tanvi Rao", 2024, 1), ("stu_harsh", "Harsh Patel", 2023, 6)]:
        student(sid, name, batch, "ELIGIBLE")
    db.flush()
    for sid, name, batch, days in [("stu_aarav", "Aarav Mehta", 2024, 2), ("stu_tanvi", "Tanvi Rao", 2024, 1), ("stu_harsh", "Harsh Patel", 2023, 6)]:
        note(sid, "skills_completed", messages.skills_completed(TRACK, BADGE), now - timedelta(days=days))
    student("stu_diya", "Diya Kapoor", 2025, "NOT_ELIGIBLE", 3); student("stu_ritu", "Ritu Sharma", 2025, "NOT_ELIGIBLE", 2)
    db.flush()
    b, sl = book("stu_kabir", "iv_priya", at(1, 11), "active"); student("stu_kabir", "Kabir Singh", 2024, "BOOKED")
    soon = (now + timedelta(minutes=40)).replace(second=0, microsecond=0); soon += timedelta(minutes=(30 - soon.minute % 30) % 30)
    book("stu_neha", "iv_rahul", soon, "active"); student("stu_neha", "Neha Joshi", 2024, "BOOKED")
    book("stu_dev", "iv_sana", at(-2, 17), "active"); student("stu_dev", "Dev Malhotra", 2023, "BOOKED")
    b, sl = book("stu_meera", "iv_priya", at(-3, 11), "completed"); r = result(b, sl, "pass", "Strong fundamentals."); student("stu_meera", "Meera Iyer", 2024, "PASSED", badge_awarded_at=r)
    b, sl = book("stu_rohan", "iv_rahul", at(-2, 12), "completed"); r = result(b, sl, "fail", "Revisit state management and error handling.")
    student("stu_rohan", "Rohan Das", 2023, "FAILED", fail_count=1, next_eligible_at=r + timedelta(days=POLICY.fail_cooldown_days))
    b, sl = book("stu_sneha", "iv_sana", at(-1, 16, 30), "completed"); r = result(b, sl, "retake", "Solid UI work. Revisit prompt design and evaluation basics.")
    student("stu_sneha", "Sneha Reddy", 2024, "RETAKE_PENDING", next_eligible_at=r + timedelta(days=POLICY.retake_cooldown_days))
    b, sl = book("stu_vikram", "iv_priya", at(-1, 10, 30), "no_show"); r = result(b, sl, "no_show")
    student("stu_vikram", "Vikram Bose", 2025, "RETAKE_PENDING", no_shows=1, next_eligible_at=r + timedelta(days=POLICY.no_show_cooldown_days))
    student("stu_ishaan", "Ishaan Verma", 2023, "NULLIFIED", nullified_at=now - timedelta(days=1), state_reason="Answers were read from a hidden second screen.")
    student("stu_ananya", "Ananya Gupta", 2024, "ON_HOLD", state_reason="Contest submission matched another student.")


if __name__ == "__main__":
    with SessionLocal() as s:
        reset_and_seed(s); print("seeded", s.scalar(select(Student.id).limit(1)) and "ok")
