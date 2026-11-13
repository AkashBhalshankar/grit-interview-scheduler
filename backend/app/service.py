"""All state-changing logic. One public function = one transaction; the caller commits (see api.run).
Concurrency: rows are locked with SELECT ... FOR UPDATE, and the partial unique indexes in the database are the
final guard, so even a bug here cannot create a double booking (IntegrityError is translated to SLOT_TAKEN)."""
from __future__ import annotations

import secrets
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import ai, messages
from .models import AuditLog, Booking, Interview, Interviewer, InterviewerTrack, Notification, Slot, Student, StudentSkill
from .rules import IST, POLICY, RuleError, SlotCtx, StudentCtx, check_can_book, check_can_cancel, check_can_record, cooldown_until, slot_grid
from .states import BOOKED, ELIGIBLE, FAILED, NOT_ELIGIBLE, NULLIFIED, ON_HOLD, PASSED, RETAKE_PENDING, next_state

POOL = (ELIGIBLE, BOOKED, FAILED, RETAKE_PENDING)


def utc(dt):
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _id(prefix): return f"{prefix}_{secrets.token_hex(5)}"


def _get(db, model, pk, what):
    obj = db.get(model, pk)
    if obj is None:
        raise RuleError("NOT_FOUND", f"{what} not found", 404)
    return obj


def _lock_student(db, sid):
    st = db.execute(select(Student).where(Student.id == sid).with_for_update()).scalar_one_or_none()
    if st is None:
        raise RuleError("NOT_FOUND", "Student not found", 404)
    return st


def _audit(db, now, role, actor, action, entity, entity_id, detail=None):
    db.add(AuditLog(id=_id("au"), at=now, actor_role=role, actor_id=actor, action=action, entity=entity, entity_id=entity_id, detail=detail))


def _notify(db, now, student_id, kind, msg):
    db.add(Notification(id=_id("nt"), student_id=student_id, kind=kind, title=msg[0], body=msg[1], created_at=now))


def _ctx(st): return StudentCtx(st.state, st.track, st.fail_count, utc(st.next_eligible_at))
def _tracks(db, iid): return tuple(db.scalars(select(InterviewerTrack.track).where(InterviewerTrack.interviewer_id == iid)))


def _slot_ctx(db, slot): return SlotCtx(slot.status, utc(slot.starts_at), slot.interviewer_id, _tracks(db, slot.interviewer_id))


def _prior(db, st):   # interviewers who already assessed this student for this badge
    return set(db.scalars(select(Slot.interviewer_id).join(Booking, Booking.slot_id == Slot.id)
                          .where(Booking.student_id == st.id, Booking.badge == st.badge, Booking.status == "completed")))


def _active(db, sid, badge=None):
    q = select(Booking).where(Booking.student_id == sid, Booking.status == "active")
    return db.execute(q).scalars().first()


def _conflict(e: IntegrityError) -> RuleError:
    m = str(getattr(e, "orig", e))
    if "uq_booking_active_student" in m or "bookings.student_id" in m:
        return RuleError("ALREADY_BOOKED", "You already have an interview booked. Cancel it first to pick another slot.")
    if "uq_booking_active_slot" in m or "bookings.slot_id" in m:
        return RuleError("SLOT_TAKEN", "Someone just took this slot. Please pick another one.")
    if "uq_slot_interviewer_start" in m or "slots.interviewer_id" in m:
        return RuleError("SLOT_EXISTS", "That slot already exists.")
    return RuleError("CONFLICT", "That change conflicted with another one. Please try again.")


def _flush(db):
    try:
        db.flush()
    except IntegrityError as e:
        db.rollback()
        raise _conflict(e) from e


# ------------------------------------------------------------ cooldowns (lazy, applied on read and before every action)
def refresh_cooldown(db, st, now):
    if st.state in (FAILED, RETAKE_PENDING) and st.next_eligible_at and utc(st.next_eligible_at) <= now:
        if st.state == FAILED and st.fail_count >= POLICY.max_fails:
            return
        st.state = next_state(st.state, "COOLDOWN_ELAPSED"); st.next_eligible_at = None
        _notify(db, now, st.id, "cooldown_over", messages.cooldown_over(st.track, st.badge))


def refresh_cooldowns(db, now):
    for st in db.scalars(select(Student).where(Student.state.in_((FAILED, RETAKE_PENDING)), Student.next_eligible_at <= now)):
        refresh_cooldown(db, st, now)


def _release(db, now, booking, new_status, slot_status):
    slot = db.get(Slot, booking.slot_id); st = db.get(Student, booking.student_id)
    booking.status, booking.cancelled_at, slot.status = new_status, now, slot_status
    if st.state == BOOKED:
        st.state = next_state(BOOKED, "CANCEL")
    return slot, st


# ------------------------------------------------------------ student actions
def book_slot(db: Session, now, student_id, slot_id):
    st = _lock_student(db, student_id); refresh_cooldown(db, st, now)
    slot = db.execute(select(Slot).where(Slot.id == slot_id).with_for_update()).scalar_one_or_none()
    if slot is None:
        raise RuleError("NOT_FOUND", "Slot not found", 404)
    check_can_book(_ctx(st), _slot_ctx(db, slot), now, POLICY, _prior(db, st), _active(db, st.id) is not None)
    iv = db.get(Interviewer, slot.interviewer_id)
    b = Booking(id=_id("bk"), slot_id=slot.id, student_id=st.id, badge=st.badge, status="active", created_at=now,
                meet_link=f"https://meet.example.com/grit-{secrets.token_hex(4)}")
    slot.status = "booked"; st.state = next_state(st.state, "BOOK"); db.add(b); _flush(db)
    _notify(db, now, st.id, "booking_confirmed", messages.booking_confirmed(st.track, st.badge, utc(slot.starts_at), iv.name))
    _audit(db, now, "student", st.id, "BOOK", "booking", b.id)
    return b


def cancel_booking(db, now, student_id, booking_id):
    st = _lock_student(db, student_id)
    b = db.execute(select(Booking).where(Booking.id == booking_id).with_for_update()).scalar_one_or_none() or _get(db, Booking, booking_id, "Booking")
    if b.student_id != student_id:
        raise RuleError("FORBIDDEN", "This is not your booking.", 403)
    if b.status != "active":
        raise RuleError("NOT_ACTIVE", "This booking is no longer active.")
    slot = db.get(Slot, b.slot_id); check_can_cancel(utc(slot.starts_at), now, POLICY, "student")
    _release(db, now, b, "cancelled_by_student", "open")
    _notify(db, now, st.id, "cancelled", messages.cancelled_by_student(utc(slot.starts_at))); _audit(db, now, "student", st.id, "CANCEL", "booking", b.id)


def reschedule_booking(db, now, student_id, booking_id, new_slot_id):
    """Atomic swap in ONE transaction: if the new slot cannot be claimed, the old booking is untouched."""
    st = _lock_student(db, student_id)
    old = db.execute(select(Booking).where(Booking.id == booking_id).with_for_update()).scalar_one_or_none() or _get(db, Booking, booking_id, "Booking")
    if old.student_id != student_id:
        raise RuleError("FORBIDDEN", "This is not your booking.", 403)
    if old.status != "active":
        raise RuleError("NOT_ACTIVE", "This booking is no longer active.")
    if old.slot_id == new_slot_id:
        raise RuleError("SAME_SLOT", "That is already your slot.")
    old_slot = db.get(Slot, old.slot_id); check_can_cancel(utc(old_slot.starts_at), now, POLICY, "student")
    slot = db.execute(select(Slot).where(Slot.id == new_slot_id).with_for_update()).scalar_one_or_none() or _get(db, Slot, new_slot_id, "Slot")
    check_can_book(StudentCtx(ELIGIBLE, st.track, st.fail_count), _slot_ctx(db, slot), now, POLICY, _prior(db, st), False)
    old.status, old.cancelled_at, old_slot.status = "cancelled_by_student", now, "open"
    _flush(db)                                        # free the student's "one active booking" before inserting the new one
    b = Booking(id=_id("bk"), slot_id=slot.id, student_id=st.id, badge=st.badge, status="active", created_at=now, meet_link=f"https://meet.example.com/grit-{secrets.token_hex(4)}")
    slot.status = "booked"; db.add(b); _flush(db)
    _notify(db, now, st.id, "booking_confirmed", messages.booking_confirmed(st.track, st.badge, utc(slot.starts_at), db.get(Interviewer, slot.interviewer_id).name))
    _audit(db, now, "student", st.id, "RESCHEDULE", "booking", b.id)
    return b


def mark_read(db, now, student_id):
    for n in db.scalars(select(Notification).where(Notification.student_id == student_id, Notification.read_at.is_(None))):
        n.read_at = now


# ------------------------------------------------------------ interviewer actions
def add_availability(db, now, interviewer_id, start: datetime, end: datetime):
    _get(db, Interviewer, interviewer_id, "Interviewer")
    created = reopened = skipped = 0
    for t in slot_grid(start, end, now, POLICY):
        t = t.astimezone(timezone.utc)
        ex = db.execute(select(Slot).where(Slot.interviewer_id == interviewer_id, Slot.starts_at == t)).scalar_one_or_none()
        if ex is None:
            db.add(Slot(id=_id("sl"), interviewer_id=interviewer_id, starts_at=t, ends_at=t + timedelta(minutes=POLICY.slot_minutes), status="open", created_at=now)); created += 1
        elif ex.status == "cancelled":
            ex.status = "open"; reopened += 1
        else:
            skipped += 1
    _flush(db); _audit(db, now, "interviewer", interviewer_id, "ADD_AVAILABILITY", "slot", "-", f"{created} new, {reopened} reopened, {skipped} existing")
    return {"created": created, "reopened": reopened, "skipped": skipped}


def cancel_slot(db, now, interviewer_id, slot_id):
    slot = db.execute(select(Slot).where(Slot.id == slot_id).with_for_update()).scalar_one_or_none() or _get(db, Slot, slot_id, "Slot")
    if slot.interviewer_id != interviewer_id:
        raise RuleError("FORBIDDEN", "This is not your slot.", 403)
    if slot.status == "cancelled":
        return {"released": False}
    check_can_cancel(utc(slot.starts_at), now, POLICY, "interviewer")
    b = db.execute(select(Booking).where(Booking.slot_id == slot_id, Booking.status == "active").with_for_update()).scalar_one_or_none()
    if b:
        _, st = _release(db, now, b, "cancelled_by_interviewer", "cancelled")
        _notify(db, now, st.id, "slot_released", messages.slot_released(utc(slot.starts_at)))
    slot.status = "cancelled"; _audit(db, now, "interviewer", interviewer_id, "RELEASE_BOOKED_SLOT" if b else "CLOSE_SLOT", "slot", slot_id)
    return {"released": b is not None}


def record_outcome(db, now, interviewer_id, booking_id, outcome, notes=None, retake_after=None):
    b = db.execute(select(Booking).where(Booking.id == booking_id).with_for_update()).scalar_one_or_none() or _get(db, Booking, booking_id, "Booking")
    slot = db.get(Slot, b.slot_id)
    if slot.interviewer_id != interviewer_id:
        raise RuleError("FORBIDDEN", "This is not your interview.", 403)
    if b.status in ("completed", "no_show"):
        raise RuleError("ALREADY_RECORDED", "An outcome is already recorded for this interview.")
    if b.status != "active":
        raise RuleError("NOT_ACTIVE", "This booking was cancelled.")
    check_can_record(utc(slot.starts_at), now, outcome, notes, utc(retake_after), POLICY)
    st = _lock_student(db, b.student_id); text = (notes or "").strip() or None
    db.add(Interview(id=_id("iv"), booking_id=b.id, interviewer_id=interviewer_id, outcome=outcome, notes=text, retake_after=retake_after, recorded_at=now, recorded_by=interviewer_id))
    b.status = "no_show" if outcome == "no_show" else "completed"
    if outcome == "pass":
        st.state = next_state(st.state, "PASS"); st.badge_awarded_at = now
        _notify(db, now, st.id, "result", messages.result_pass(st.track, st.badge))
    elif outcome == "fail":
        st.state = next_state(st.state, "FAIL"); st.fail_count += 1; st.next_eligible_at = cooldown_until("fail", now, POLICY)
        _notify(db, now, st.id, "result", messages.result_fail(st.track, st.badge, text, st.next_eligible_at, max(0, POLICY.max_fails - st.fail_count)))
    elif outcome == "retake":
        st.state = next_state(st.state, "RETAKE"); st.next_eligible_at = cooldown_until("retake", now, POLICY, retake_after=utc(retake_after))
        _notify(db, now, st.id, "result", messages.result_retake(st.track, st.badge, text, st.next_eligible_at))
    else:
        st.state = next_state(st.state, "NO_SHOW"); st.no_shows += 1; st.next_eligible_at = cooldown_until("no_show", now, POLICY, st.no_shows)
        _notify(db, now, st.id, "result", messages.no_show(utc(slot.starts_at), st.next_eligible_at))
    _flush(db); _audit(db, now, "interviewer", interviewer_id, f"OUTCOME_{outcome.upper()}", "booking", b.id)


# ------------------------------------------------------------ team actions
def flag_malpractice(db, now, team_id, student_id, reason):
    st = _lock_student(db, student_id)
    if len((reason or "").strip()) < 5:
        raise RuleError("BAD_REASON", "Add a short reason (at least 5 characters).", 422)
    was = st.state; to = next_state(was, "FLAG_MALPRACTICE")
    if was == BOOKED:
        _release(db, now, _active(db, st.id), "cancelled_by_team", "open")
    st.state, st.state_reason = to, reason.strip()
    if to == NULLIFIED:
        st.nullified_at, st.badge_awarded_at = now, None
        _notify(db, now, st.id, "nullified", messages.nullified(st.track, st.badge, st.state_reason))
    else:
        _notify(db, now, st.id, "on_hold", messages.on_hold(st.track, st.badge))
    _audit(db, now, "team", team_id, "FLAG_MALPRACTICE", "student", st.id, f"{was} -> {to}: {st.state_reason}")


def _skills_done(db, sid):
    rows = list(db.scalars(select(StudentSkill.cleared).where(StudentSkill.student_id == sid)))
    return bool(rows) and all(rows)


def reinstate(db, now, team_id, student_id):
    st = _lock_student(db, student_id); st.state = next_state(st.state, "REINSTATE"); st.state_reason = None
    if not _skills_done(db, st.id):
        st.state = next_state(st.state, "SKILL_INVALIDATED")
    _notify(db, now, st.id, "reinstated", messages.reinstated(st.track, st.badge)); _audit(db, now, "team", team_id, "REINSTATE", "student", st.id)


def overturn(db, now, team_id, student_id):
    st = _lock_student(db, student_id); st.state = next_state(st.state, "OVERTURN")
    st.nullified_at, st.state_reason, st.badge_awarded_at = None, None, now
    _notify(db, now, st.id, "overturned", messages.overturned(st.track, st.badge)); _audit(db, now, "team", team_id, "OVERTURN", "student", st.id)


def grant_attempt(db, now, team_id, student_id):
    """Team override: lifts a cooldown or the max-attempts block (also the escape when no new interviewer is left)."""
    st = _lock_student(db, student_id)
    if st.state not in (FAILED, RETAKE_PENDING):
        raise RuleError("NOT_NEEDED", "This student is not waiting on a cooldown.")
    st.state = next_state(st.state, "COOLDOWN_ELAPSED"); st.next_eligible_at, st.fail_count = None, 0
    _notify(db, now, st.id, "cooldown_over", messages.cooldown_over(st.track, st.badge)); _audit(db, now, "team", team_id, "GRANT_ATTEMPT", "student", st.id)


def open_slot_count(db, now, st):
    q = select(func.count()).select_from(Slot).join(InterviewerTrack, InterviewerTrack.interviewer_id == Slot.interviewer_id).where(
        InterviewerTrack.track == st.track, Slot.status == "open", Slot.starts_at >= now + timedelta(hours=POLICY.min_lead_hours), Slot.starts_at <= now + timedelta(days=7))
    return db.scalar(q) or 0


def send_reminder(db, now, team_id, student_id, use_ai=True):
    st = _lock_student(db, student_id); refresh_cooldown(db, st, now)
    if st.state != ELIGIBLE:
        raise RuleError("NOT_REMINDABLE", "Only students who can book right now can be reminded.")
    last = db.scalar(select(func.max(Notification.created_at)).where(Notification.student_id == st.id, Notification.kind == "reminder"))
    if last and now - utc(last) < timedelta(hours=POLICY.reminder_throttle_hours):
        raise RuleError("REMINDER_THROTTLED", f"Already reminded. One reminder per {POLICY.reminder_throttle_hours} hours.", 429)
    n = open_slot_count(db, now, st)
    d = ai.draft_reminder(st.track, st.badge, n, st.name.split()[0]) if use_ai else {"title": messages.reminder(st.track, st.badge, n)[0], "body": messages.reminder(st.track, st.badge, n)[1], "source": "template"}
    _notify(db, now, st.id, "reminder", (d["title"], d["body"])); _audit(db, now, "team", team_id, "REMIND", "student", st.id, d["source"])
    return d


def set_skill(db, now, student_id, skill, level, cleared):   # demo / contest-system hook
    st = _lock_student(db, student_id)
    row = db.get(StudentSkill, (student_id, skill, level)) or _get(db, StudentSkill, (student_id, skill, level), "Skill")
    row.cleared = cleared; db.flush()
    if not cleared and st.state in (ELIGIBLE, BOOKED, RETAKE_PENDING, FAILED):
        if st.state == BOOKED:
            _release(db, now, _active(db, st.id), "cancelled_by_team", "open")
        st.state = next_state(st.state, "SKILL_INVALIDATED"); _notify(db, now, st.id, "skill_invalidated", messages.skill_invalidated(st.track, st.badge, f"{skill} {level}"))
    elif cleared and st.state == NOT_ELIGIBLE and _skills_done(db, st.id):
        st.state = next_state(st.state, "SKILLS_COMPLETED"); _notify(db, now, st.id, "skills_completed", messages.skills_completed(st.track, st.badge))


# ------------------------------------------------------------ queries
def bookable_slots(db, now, student_id, days=14):
    st = _get(db, Student, student_id, "Student"); prior = _prior(db, st)
    rows = db.execute(select(Slot, Interviewer).join(Interviewer, Interviewer.id == Slot.interviewer_id).join(InterviewerTrack, InterviewerTrack.interviewer_id == Slot.interviewer_id)
                      .where(InterviewerTrack.track == st.track, Slot.status == "open", Slot.starts_at >= now + timedelta(hours=POLICY.min_lead_hours), Slot.starts_at <= now + timedelta(days=days))
                      .order_by(Slot.starts_at)).all()
    slots = [{"id": s.id, "interviewer_id": s.interviewer_id, "interviewer_name": i.name, "starts_at": utc(s.starts_at), "ends_at": utc(s.ends_at)} for s, i in rows if s.interviewer_id not in prior]
    load = dict(db.execute(select(Slot.interviewer_id, func.count()).where(Slot.status == "booked", Slot.starts_at >= now).group_by(Slot.interviewer_id)).all())
    return {"slots": slots, "recommended": ai.suggest_slots(slots, now, load)}


def student_dashboard(db, now, student_id):
    st = _get(db, Student, student_id, "Student"); refresh_cooldown(db, st, now)
    try:
        check_can_book(_ctx(st), SlotCtx("open", now + timedelta(hours=POLICY.min_lead_hours + 1), "_", (st.track,)), now, POLICY, set(), False); gate = {"ok": True}
    except RuleError as e:
        gate = {"ok": False, "code": e.code, "message": e.message}
    b = _active(db, st.id); slot = db.get(Slot, b.slot_id) if b else None
    last = db.execute(select(Interview).join(Booking, Booking.id == Interview.booking_id).where(Booking.student_id == st.id).order_by(Interview.recorded_at.desc())).scalars().first()
    return {"student": {c: getattr(st, c) for c in ("id", "name", "state", "track", "badge", "fail_count", "next_eligible_at", "badge_awarded_at", "state_reason")},
            "skills": [{"skill": k.skill, "level": k.level, "cleared": k.cleared} for k in db.scalars(select(StudentSkill).where(StudentSkill.student_id == st.id))],
            "can_book": gate, "booking": None if not b else {"id": b.id, "starts_at": utc(slot.starts_at), "interviewer": db.get(Interviewer, slot.interviewer_id).name,
                                                             "join_link": b.meet_link if now >= utc(slot.starts_at) - timedelta(minutes=POLICY.join_opens_minutes) else None,
                                                             "can_change_until": utc(slot.starts_at) - timedelta(hours=POLICY.cancel_cutoff_hours)},
            "last_result": None if not last else {"outcome": last.outcome, "notes": last.notes, "recorded_at": last.recorded_at},
            "notifications": [{"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "created_at": n.created_at, "read": n.read_at is not None}
                              for n in db.scalars(select(Notification).where(Notification.student_id == st.id).order_by(Notification.created_at.desc()).limit(20))]}


def interviewer_schedule(db, now, interviewer_id, day: date):
    lo = datetime(day.year, day.month, day.day, tzinfo=IST).astimezone(timezone.utc); hi = lo + timedelta(days=1)
    out = []
    for slot in db.scalars(select(Slot).where(Slot.interviewer_id == interviewer_id, Slot.starts_at >= lo, Slot.starts_at < hi).order_by(Slot.starts_at)):
        b = db.execute(select(Booking).where(Booking.slot_id == slot.id, Booking.status.in_(("active", "completed", "no_show")))).scalars().first()
        st = db.get(Student, b.student_id) if b else None; iv = db.execute(select(Interview).where(Interview.booking_id == b.id)).scalars().first() if b else None
        out.append({"slot_id": slot.id, "starts_at": utc(slot.starts_at), "ends_at": utc(slot.ends_at), "slot_status": slot.status, "booking_id": b.id if b else None, "booking_status": b.status if b else None,
                    "student": None if not st else {"id": st.id, "name": st.name, "batch": st.batch}, "outcome": iv.outcome if iv else None,
                    "can_record": bool(b and b.status == "active" and now >= utc(slot.starts_at)),
                    "overdue": bool(b and b.status == "active" and now > utc(slot.ends_at) + timedelta(hours=POLICY.outcome_overdue_hours))})
    return out


def team_overview(db, now):
    refresh_cooldowns(db, now); booked, not_booked, others = [], [], {}
    for st in db.scalars(select(Student).order_by(Student.name)):
        if st.state not in POOL:
            others[st.state] = others.get(st.state, 0) + 1; continue
        if st.state == BOOKED:
            b = _active(db, st.id); slot = db.get(Slot, b.slot_id)
            booked.append({"student_id": st.id, "name": st.name, "batch": st.batch, "starts_at": utc(slot.starts_at), "interviewer": db.get(Interviewer, slot.interviewer_id).name,
                           "awaiting_outcome": now >= utc(slot.ends_at), "overdue": now > utc(slot.ends_at) + timedelta(hours=POLICY.outcome_overdue_hours)})
        else:
            not_booked.append({"student_id": st.id, "name": st.name, "batch": st.batch, "state": st.state, "can_book_now": st.state == ELIGIBLE, "next_eligible_at": utc(st.next_eligible_at)})
    return {"eligible_count": len(booked) + len(not_booked), "booked": sorted(booked, key=lambda r: r["starts_at"]), "not_booked": not_booked, "others": others}


def audit_log(db, limit=100):
    return [{c: getattr(a, c) for c in ("at", "actor_role", "actor_id", "action", "entity", "entity_id", "detail")} for a in db.scalars(select(AuditLog).order_by(AuditLog.at.desc()).limit(limit))]
