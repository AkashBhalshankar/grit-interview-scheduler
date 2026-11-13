"""HTTP layer: thin. Parses input, runs ONE service call in ONE transaction, returns JSON. Rules live in service/rules/states.
Auth is out of scope for the prototype: in production the student/interviewer/team identity comes from GRIT SSO and each
route checks that the path id equals the caller (ownership is already checked inside the service)."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from . import ai, service
from .config import settings
from .db import get_db
from .schemas import AvailabilityIn, BookIn, FlagIn, OutcomeIn, RemindIn, RescheduleIn, SkillIn

router = APIRouter()


def get_now(x_demo_offset_minutes: int | None = Header(default=None)) -> datetime:
    """Demo clock: lets a reviewer fast-forward past an interview. Ignored unless DEMO_MODE=1."""
    now = datetime.now(timezone.utc)
    return now + timedelta(minutes=x_demo_offset_minutes) if settings.demo_mode and x_demo_offset_minutes else now


def run(db: Session, fn, *args, **kw):
    try:
        out = fn(db, *args, **kw); db.commit(); return out
    except Exception:
        db.rollback(); raise


def _booking(b): return {"booking_id": b.id, "slot_id": b.slot_id, "status": b.status}


@router.get("/health")
def health(): return {"ok": True}


# ---- student
@router.get("/students/{sid}/dashboard")
def dashboard(sid: str, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    return run(db, service.student_dashboard, now, sid)


@router.get("/students/{sid}/slots")
def slots(sid: str, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    return service.bookable_slots(db, now, sid)


@router.post("/students/{sid}/bookings", status_code=201)
def book(sid: str, body: BookIn, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    return _booking(run(db, service.book_slot, now, sid, body.slot_id))


@router.post("/students/{sid}/bookings/{bid}/reschedule")
def reschedule(sid: str, bid: str, body: RescheduleIn, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    return _booking(run(db, service.reschedule_booking, now, sid, bid, body.slot_id))


@router.post("/students/{sid}/bookings/{bid}/cancel")
def cancel(sid: str, bid: str, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    run(db, service.cancel_booking, now, sid, bid); return {"ok": True}


@router.post("/students/{sid}/notifications/read")
def read(sid: str, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    run(db, service.mark_read, now, sid); return {"ok": True}


# ---- interviewer
@router.get("/interviewers/{iid}/schedule")
def schedule(iid: str, day: date, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    return service.interviewer_schedule(db, now, iid, day)


@router.post("/interviewers/{iid}/availability", status_code=201)
def availability(iid: str, body: AvailabilityIn, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    return run(db, service.add_availability, now, iid, body.start, body.end)


@router.delete("/interviewers/{iid}/slots/{slot_id}")
def close_slot(iid: str, slot_id: str, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    return run(db, service.cancel_slot, now, iid, slot_id)


@router.post("/interviewers/{iid}/bookings/{bid}/outcome")
def outcome(iid: str, bid: str, body: OutcomeIn, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    run(db, service.record_outcome, now, iid, bid, body.outcome, body.notes, body.retake_after); return {"ok": True}


# ---- interview team
@router.get("/team/overview")
def overview(db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    return run(db, service.team_overview, now)


@router.get("/team/audit")
def audit(db: Session = Depends(get_db)): return service.audit_log(db)


@router.post("/team/students/{sid}/remind")
def remind(sid: str, body: RemindIn, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    return run(db, service.send_reminder, now, "team", sid, body.use_ai)


@router.post("/team/students/{sid}/flag")
def flag(sid: str, body: FlagIn, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    run(db, service.flag_malpractice, now, "team", sid, body.reason); return {"ok": True}


@router.post("/team/students/{sid}/{action}")
def team_action(sid: str, action: str, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    fn = {"reinstate": service.reinstate, "overturn": service.overturn, "grant-attempt": service.grant_attempt}.get(action)
    if fn is None:
        raise HTTPException(404, "Unknown action")
    run(db, fn, now, "team", sid); return {"ok": True}


@router.post("/ai/reminder")
def ai_reminder(body: dict, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    st = service._get(db, service.Student, body.get("student_id", ""), "Student")
    return ai.draft_reminder(st.track, st.badge, service.open_slot_count(db, now, st), st.name.split()[0])


# ---- demo helpers (only when DEMO_MODE=1)
demo = APIRouter(prefix="/demo")


@demo.post("/reset")
def reset(db: Session = Depends(get_db)):
    from .seed import reset_and_seed
    reset_and_seed(db); return {"ok": True}


@demo.post("/students/{sid}/skills")
def skill(sid: str, body: SkillIn, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    run(db, service.set_skill, now, sid, body.skill, body.level, body.cleared); return {"ok": True}