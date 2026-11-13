// In-browser equivalent of backend/app/service.py. Every action is ONE transaction: it works on a clone of the
// state and only replaces it if every rule and every "unique index" holds, so a failed action changes nothing.
import { POLICY, RuleError, checkCanBook, checkCanCancel, checkCanRecord, cooldownUntil, slotGrid } from './rules.js';
import { S, nextState } from './states.js';
import * as M from './messages.js';
import { suggestSlots } from './suggest.js';
import { DAY, HOUR, MIN, dayKey, fmtDt, parseIST, startOfDay } from './time.js';

export { RuleError, POLICY };

export const nowOf = (s) => Date.now() + (s.meta.clockOffsetMin || 0) * MIN;
const uid = (s, p) => `${p}_${(s.meta.seq++).toString(36)}`;
const get = (coll, id, what) => { const v = coll[id]; if (!v) throw new RuleError('NOT_FOUND', `${what} not found`, 404); return v; };

// ---- "database constraints": the same two partial unique indexes as backend/db/schema.sql ----
function assertIndexes(s) {
  const slots = new Set(), students = new Set(), starts = new Set();
  for (const b of Object.values(s.bookings)) {
    if (b.status !== 'active') continue;
    if (slots.has(b.slotId)) throw new RuleError('SLOT_TAKEN', 'Someone just took this slot. Please pick another one.');
    slots.add(b.slotId);
    const k = `${b.studentId}|${b.badge}`;
    if (students.has(k)) throw new RuleError('ALREADY_BOOKED', 'You already have an interview booked. Cancel it first to pick another slot.');
    students.add(k);
  }
  for (const sl of Object.values(s.slots)) {
    const k = `${sl.interviewerId}|${sl.startsAt}`;
    if (starts.has(k)) throw new RuleError('SLOT_EXISTS', 'That slot already exists.');
    starts.add(k);
  }
}

export function transact(state, fn) {
  const draft = structuredClone(state);
  refreshCooldowns(draft);
  const result = fn(draft, nowOf(draft));
  refreshCooldowns(draft);   // time may have moved (demo clock), so settle any cooldown that just ended
  assertIndexes(draft);
  return { state: draft, result };
}

const audit = (s, now, role, actorId, action, entity, entityId, detail = null) =>
  s.audit.unshift({ id: uid(s, 'au'), at: now, role, actorId, action, entity, entityId, detail });
const notify = (s, now, studentId, kind, [title, body]) =>
  s.notifications.unshift({ id: uid(s, 'nt'), studentId, kind, title, body, createdAt: now, readAt: null });

export const skillsComplete = (st) => st.skills.length > 0 && st.skills.every((k) => k.cleared);
const tracksOf = (s, iid) => s.interviewers[iid].tracks;
const activeBookingOf = (s, sid) => Object.values(s.bookings).find((b) => b.studentId === sid && b.status === 'active') || null;
const priorInterviewers = (s, st) => new Set(Object.values(s.bookings)
  .filter((b) => b.studentId === st.id && b.badge === st.badge && b.status === 'completed').map((b) => s.slots[b.slotId].interviewerId));

function refreshCooldowns(s) {
  const now = nowOf(s);
  for (const st of Object.values(s.students)) {
    if ((st.state === S.FAILED || st.state === S.RETAKE_PENDING) && st.nextEligibleAt && st.nextEligibleAt <= now) {
      if (st.state === S.FAILED && st.failCount >= POLICY.maxFails) continue;
      st.state = nextState(st.state, 'COOLDOWN_ELAPSED');
      st.nextEligibleAt = null;
      notify(s, now, st.id, 'cooldown_over', M.cooldown_over(st.track, st.badge));
    }
  }
}
export const tick = (state) => transact(state, () => null).state;

function release(s, now, booking, newStatus) {
  const slot = s.slots[booking.slotId], st = s.students[booking.studentId];
  booking.status = newStatus; booking.cancelledAt = now;
  if (st.state === S.BOOKED) st.state = nextState(S.BOOKED, 'CANCEL');
  return { slot, st };
}

// ------------------------------------------------------------------ student actions
export function bookSlot(state, { studentId, slotId }) {
  return transact(state, (s, now) => {
    const st = get(s.students, studentId, 'Student'), slot = get(s.slots, slotId, 'Slot');
    checkCanBook(st, { status: slot.status, startsAt: slot.startsAt, interviewerId: slot.interviewerId, interviewerTracks: tracksOf(s, slot.interviewerId) },
      now, POLICY, priorInterviewers(s, st), !!activeBookingOf(s, st.id));
    const b = { id: uid(s, 'bk'), slotId, studentId, badge: st.badge, status: 'active', meetLink: `https://meet.example.com/grit-${s.meta.seq}`, createdAt: now, cancelledAt: null };
    s.bookings[b.id] = b; slot.status = 'booked'; st.state = nextState(st.state, 'BOOK');
    notify(s, now, st.id, 'booking_confirmed', M.booking_confirmed(st.track, st.badge, slot.startsAt, s.interviewers[slot.interviewerId].name));
    audit(s, now, 'student', st.id, 'BOOK', 'booking', b.id, fmtDt(slot.startsAt));
    return b.id;
  });
}

export function cancelBooking(state, { studentId, bookingId }) {
  return transact(state, (s, now) => {
    const b = get(s.bookings, bookingId, 'Booking');
    if (b.studentId !== studentId) throw new RuleError('FORBIDDEN', 'This is not your booking.', 403);
    if (b.status !== 'active') throw new RuleError('NOT_ACTIVE', 'This booking is no longer active.');
    const slot = s.slots[b.slotId];
    checkCanCancel(slot.startsAt, now, POLICY, 'student');
    const { st } = release(s, now, b, 'cancelled_by_student'); slot.status = 'open';
    notify(s, now, st.id, 'cancelled', M.cancelled_by_student(slot.startsAt));
    audit(s, now, 'student', st.id, 'CANCEL', 'booking', b.id);
    return true;
  });
}

// Atomic swap: the new slot is claimed and the old one released together, or nothing changes.
export function rescheduleBooking(state, { studentId, bookingId, newSlotId }) {
  return transact(state, (s, now) => {
    const old = get(s.bookings, bookingId, 'Booking'), st = get(s.students, studentId, 'Student');
    if (old.studentId !== studentId) throw new RuleError('FORBIDDEN', 'This is not your booking.', 403);
    if (old.status !== 'active') throw new RuleError('NOT_ACTIVE', 'This booking is no longer active.');
    if (old.slotId === newSlotId) throw new RuleError('SAME_SLOT', 'That is already your slot.');
    const oldSlot = s.slots[old.slotId], slot = get(s.slots, newSlotId, 'Slot');
    checkCanCancel(oldSlot.startsAt, now, POLICY, 'student');
    checkCanBook({ ...st, state: S.ELIGIBLE }, { status: slot.status, startsAt: slot.startsAt, interviewerId: slot.interviewerId, interviewerTracks: tracksOf(s, slot.interviewerId) },
      now, POLICY, priorInterviewers(s, st), false);
    old.status = 'cancelled_by_student'; old.cancelledAt = now; oldSlot.status = 'open';
    const b = { id: uid(s, 'bk'), slotId: newSlotId, studentId, badge: st.badge, status: 'active', meetLink: `https://meet.example.com/grit-${s.meta.seq}`, createdAt: now, cancelledAt: null };
    s.bookings[b.id] = b; slot.status = 'booked';
    notify(s, now, st.id, 'booking_confirmed', M.booking_confirmed(st.track, st.badge, slot.startsAt, s.interviewers[slot.interviewerId].name));
    audit(s, now, 'student', st.id, 'RESCHEDULE', 'booking', b.id, `${fmtDt(oldSlot.startsAt)} -> ${fmtDt(slot.startsAt)}`);
    return b.id;
  });
}

export const markRead = (state, { studentId }) => transact(state, (s, now) => {
  s.notifications.filter((n) => n.studentId === studentId && !n.readAt).forEach((n) => { n.readAt = now; });
});

// ------------------------------------------------------------------ interviewer actions
export function addAvailability(state, { interviewerId, start, end }) {
  return transact(state, (s, now) => {
    get(s.interviewers, interviewerId, 'Interviewer');
    const starts = slotGrid(start, end, now, POLICY);
    let created = 0, reopened = 0, skipped = 0;
    for (const t of starts) {
      const ex = Object.values(s.slots).find((x) => x.interviewerId === interviewerId && x.startsAt === t);
      if (!ex) { const id = uid(s, 'sl'); s.slots[id] = { id, interviewerId, startsAt: t, endsAt: t + POLICY.slotMinutes * MIN, status: 'open', createdAt: now }; created++; }
      else if (ex.status === 'cancelled') { ex.status = 'open'; reopened++; }
      else skipped++;
    }
    audit(s, now, 'interviewer', interviewerId, 'ADD_AVAILABILITY', 'slot', '-', `${created} new, ${reopened} reopened, ${skipped} already there`);
    return { created, reopened, skipped };
  });
}

export function cancelSlot(state, { interviewerId, slotId }) {
  return transact(state, (s, now) => {
    const slot = get(s.slots, slotId, 'Slot');
    if (slot.interviewerId !== interviewerId) throw new RuleError('FORBIDDEN', 'This is not your slot.', 403);
    if (slot.status === 'cancelled') return { released: false };
    checkCanCancel(slot.startsAt, now, POLICY, 'interviewer');
    const b = Object.values(s.bookings).find((x) => x.slotId === slotId && x.status === 'active');
    if (b) {
      const { st } = release(s, now, b, 'cancelled_by_interviewer');
      notify(s, now, st.id, 'slot_released', M.slot_released(slot.startsAt));
    }
    slot.status = 'cancelled';
    audit(s, now, 'interviewer', interviewerId, b ? 'RELEASE_BOOKED_SLOT' : 'CLOSE_SLOT', 'slot', slotId);
    return { released: !!b };
  });
}

export function recordOutcome(state, { interviewerId, bookingId, outcome, notes = '', retakeAfter = null }) {
  return transact(state, (s, now) => {
    const b = get(s.bookings, bookingId, 'Booking'), slot = s.slots[b.slotId];
    if (slot.interviewerId !== interviewerId) throw new RuleError('FORBIDDEN', 'This is not your interview.', 403);
    if (b.status === 'completed' || b.status === 'no_show') throw new RuleError('ALREADY_RECORDED', 'An outcome is already recorded for this interview.');
    if (b.status !== 'active') throw new RuleError('NOT_ACTIVE', 'This booking was cancelled.');
    checkCanRecord(slot.startsAt, now, outcome, notes, retakeAfter, POLICY);
    const st = s.students[b.studentId], text = (notes || '').trim();
    const iid = uid(s, 'iv');
    s.interviews[iid] = { id: iid, bookingId, interviewerId, outcome, notes: text || null, retakeAfter, recordedAt: now, recordedBy: interviewerId };
    b.status = outcome === 'no_show' ? 'no_show' : 'completed';
    if (outcome === 'pass') {
      st.state = nextState(st.state, 'PASS'); st.badgeAwardedAt = now;
      notify(s, now, st.id, 'result', M.result_pass(st.track, st.badge));
    } else if (outcome === 'fail') {
      st.state = nextState(st.state, 'FAIL'); st.failCount += 1; st.nextEligibleAt = cooldownUntil('fail', now, POLICY);
      notify(s, now, st.id, 'result', M.result_fail(st.track, st.badge, text, st.nextEligibleAt, Math.max(0, POLICY.maxFails - st.failCount)));
    } else if (outcome === 'retake') {
      st.state = nextState(st.state, 'RETAKE'); st.nextEligibleAt = cooldownUntil('retake', now, POLICY, 1, retakeAfter);
      notify(s, now, st.id, 'result', M.result_retake(st.track, st.badge, text, st.nextEligibleAt));
    } else {
      st.state = nextState(st.state, 'NO_SHOW'); st.noShows += 1; st.nextEligibleAt = cooldownUntil('no_show', now, POLICY, st.noShows);
      notify(s, now, st.id, 'result', M.no_show(slot.startsAt, st.nextEligibleAt));
    }
    audit(s, now, 'interviewer', interviewerId, `OUTCOME_${outcome.toUpperCase()}`, 'booking', bookingId);
    return outcome;
  });
}

// ------------------------------------------------------------------ team actions
export function flagMalpractice(state, { teamId = 'team', studentId, reason }) {
  return transact(state, (s, now) => {
    const st = get(s.students, studentId, 'Student');
    if ((reason || '').trim().length < 5) throw new RuleError('BAD_REASON', 'Add a short reason (at least 5 characters).', 422);
    const was = st.state, to = nextState(was, 'FLAG_MALPRACTICE');
    if (was === S.BOOKED) { const b = activeBookingOf(s, st.id); const { slot } = release(s, now, b, 'cancelled_by_team'); slot.status = 'open'; }
    st.state = to; st.stateReason = reason.trim();
    if (to === S.NULLIFIED) { st.nullifiedAt = now; st.badgeAwardedAt = null; notify(s, now, st.id, 'nullified', M.nullified(st.track, st.badge, st.stateReason)); }
    else notify(s, now, st.id, 'on_hold', M.on_hold(st.track, st.badge));
    audit(s, now, 'team', teamId, 'FLAG_MALPRACTICE', 'student', st.id, `${was} -> ${to}: ${st.stateReason}`);
  });
}
export function reinstate(state, { teamId = 'team', studentId }) {
  return transact(state, (s, now) => {
    const st = get(s.students, studentId, 'Student');
    st.state = nextState(st.state, 'REINSTATE'); st.stateReason = null;
    if (!skillsComplete(st)) st.state = nextState(st.state, 'SKILL_INVALIDATED');
    notify(s, now, st.id, 'reinstated', M.reinstated(st.track, st.badge));
    audit(s, now, 'team', teamId, 'REINSTATE', 'student', st.id);
  });
}
export function overturn(state, { teamId = 'team', studentId }) {
  return transact(state, (s, now) => {
    const st = get(s.students, studentId, 'Student');
    st.state = nextState(st.state, 'OVERTURN'); st.nullifiedAt = null; st.stateReason = null; st.badgeAwardedAt = now;
    notify(s, now, st.id, 'overturned', M.overturned(st.track, st.badge));
    audit(s, now, 'team', teamId, 'OVERTURN', 'student', st.id);
  });
}
// Team override for "max attempts used" or "no interviewer left who has not seen this student".
export function grantAttempt(state, { teamId = 'team', studentId }) {
  return transact(state, (s, now) => {
    const st = get(s.students, studentId, 'Student');
    if (st.state !== S.FAILED && st.state !== S.RETAKE_PENDING) throw new RuleError('NOT_NEEDED', 'This student is not waiting on a cooldown.');
    st.state = nextState(st.state, 'COOLDOWN_ELAPSED'); st.nextEligibleAt = null; st.failCount = 0;
    notify(s, now, st.id, 'cooldown_over', M.cooldown_over(st.track, st.badge));
    audit(s, now, 'team', teamId, 'GRANT_ATTEMPT', 'student', st.id);
  });
}
export function sendReminder(state, { teamId = 'team', studentId, body = null }) {
  return transact(state, (s, now) => {
    const st = get(s.students, studentId, 'Student');
    if (st.state !== S.ELIGIBLE) throw new RuleError('NOT_REMINDABLE', 'Only students who can book right now can be reminded.');
    const last = s.notifications.find((n) => n.studentId === studentId && n.kind === 'reminder');
    if (last && now - last.createdAt < POLICY.reminderThrottleHours * HOUR)
      throw new RuleError('REMINDER_THROTTLED', `Already reminded ${Math.max(1, Math.round((now - last.createdAt) / HOUR))} h ago. One reminder per ${POLICY.reminderThrottleHours} h.`, 429);
    const open = bookableSlots(s, studentId).length;
    const [title, base] = M.reminder(st.track, st.badge, open);
    notify(s, now, st.id, 'reminder', [title, body || base]);
    audit(s, now, 'team', teamId, 'REMIND', 'student', st.id);
    return { open };
  });
}

// ------------------------------------------------------------------ demo controls (mirror /api/demo/*)
export const advanceClock = (state, { minutes }) => transact(state, (s) => { s.meta.clockOffsetMin = (s.meta.clockOffsetMin || 0) + minutes; });
export const resetClock = (state) => transact(state, (s) => { s.meta.clockOffsetMin = 0; });
export function setSkill(state, { studentId, skill, level, cleared }) {
  return transact(state, (s, now) => {
    const st = get(s.students, studentId, 'Student');
    const k = st.skills.find((x) => x.skill === skill && x.level === level);
    if (!k) throw new RuleError('NOT_FOUND', 'Skill not found', 404);
    k.cleared = cleared;
    if (!cleared && ['ELIGIBLE', 'BOOKED', 'RETAKE_PENDING', 'FAILED'].includes(st.state)) {
      if (st.state === S.BOOKED) { const b = activeBookingOf(s, st.id); const { slot } = release(s, now, b, 'cancelled_by_team'); slot.status = 'open'; }
      st.state = nextState(st.state, 'SKILL_INVALIDATED');
      notify(s, now, st.id, 'skill_invalidated', M.skill_invalidated(st.track, st.badge, `${skill} ${level}`));
      audit(s, now, 'team', 'contest-system', 'SKILL_INVALIDATED', 'student', st.id, `${skill} ${level}`);
    } else if (cleared && st.state === S.NOT_ELIGIBLE && skillsComplete(st)) {
      st.state = nextState(st.state, 'SKILLS_COMPLETED');
      notify(s, now, st.id, 'skills_completed', M.skills_completed(st.track, st.badge));
      audit(s, now, 'team', 'contest-system', 'SKILLS_COMPLETED', 'student', st.id);
    }
  });
}

// ------------------------------------------------------------------ queries (read-only)
export function bookableSlots(s, studentId, days = POLICY.bookingWindowDays) {
  const st = get(s.students, studentId, 'Student'), now = nowOf(s), prior = priorInterviewers(s, st);
  return Object.values(s.slots)
    .filter((x) => x.status === 'open' && x.startsAt >= now + POLICY.minLeadHours * HOUR && x.startsAt <= now + days * DAY
      && tracksOf(s, x.interviewerId).includes(st.track) && !prior.has(x.interviewerId))
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((x) => ({ ...x, interviewerName: s.interviewers[x.interviewerId].name }));
}
export function recommended(s, studentId, k = 3) {
  const slots = bookableSlots(s, studentId), load = {};
  for (const x of Object.values(s.slots)) if (x.status === 'booked' && x.startsAt >= nowOf(s)) load[x.interviewerId] = (load[x.interviewerId] || 0) + 1;
  return suggestSlots(slots, nowOf(s), load, k);
}
export function gate(s, studentId) {
  const st = s.students[studentId], now = nowOf(s);
  try {
    checkCanBook(st, { status: 'open', startsAt: now + (POLICY.minLeadHours + 1) * HOUR, interviewerId: '_', interviewerTracks: [st.track] }, now, POLICY, new Set(), false);
    return { ok: true };
  } catch (e) { if (e instanceof RuleError) return { ok: false, code: e.code, message: e.message }; throw e; }
}

export function interviewerDay(s, interviewerId, key) {
  const now = nowOf(s), from = startOfDay(key), to = from + DAY;
  return Object.values(s.slots).filter((x) => x.interviewerId === interviewerId && x.startsAt >= from && x.startsAt < to)
    .sort((a, b) => a.startsAt - b.startsAt).map((slot) => {
      const b = Object.values(s.bookings).filter((x) => x.slotId === slot.id && !x.status.startsWith('cancelled'))[0] || null;
      const st = b ? s.students[b.studentId] : null;
      const iv = b ? Object.values(s.interviews).find((x) => x.bookingId === b.id) || null : null;
      let kind = slot.status === 'cancelled' ? 'closed' : b ? (b.status === 'active' ? 'booked' : b.status) : 'open';
      const ended = slot.endsAt <= now;
      const overdue = b?.status === 'active' && now > slot.endsAt + POLICY.outcomeOverdueHours * HOUR;
      const recordAt = slot.startsAt, canRecord = b?.status === 'active' && now >= recordAt;
      return { slot, booking: b, student: st, interview: iv, kind, ended, overdue, canRecord, recordOpensAt: recordAt, noShowOpensAt: slot.startsAt + POLICY.noShowGraceMinutes * MIN };
    });
}
export function nextSessionDay(s, interviewerId) {
  const now = nowOf(s);
  const next = Object.values(s.bookings).filter((b) => b.status === 'active' && s.slots[b.slotId].interviewerId === interviewerId)
    .map((b) => s.slots[b.slotId]).sort((a, b) => a.startsAt - b.startsAt);
  const upcoming = next.find((x) => x.endsAt > now) || next[next.length - 1];
  return dayKey(upcoming ? upcoming.startsAt : now);
}

const POOL = [S.ELIGIBLE, S.BOOKED, S.FAILED, S.RETAKE_PENDING];
export function teamOverview(s) {
  const now = nowOf(s), booked = [], notBooked = [], others = {};
  for (const st of Object.values(s.students)) {
    if (!POOL.includes(st.state)) { others[st.state] = (others[st.state] || 0) + 1; continue; }
    const waitingNote = s.notifications.find((n) => n.studentId === st.id && ['skills_completed', 'cooldown_over'].includes(n.kind));
    const base = { student: st, waitingSince: waitingNote?.createdAt ?? null, lastReminder: s.notifications.find((n) => n.studentId === st.id && n.kind === 'reminder')?.createdAt ?? null };
    if (st.state === S.BOOKED) {
      const b = activeBookingOf(s, st.id), slot = s.slots[b.slotId];
      booked.push({ ...base, booking: b, slot, interviewer: s.interviewers[slot.interviewerId], overdue: now > slot.endsAt + POLICY.outcomeOverdueHours * HOUR, awaitingOutcome: now >= slot.endsAt });
    } else {
      const g = gate(s, st.id);
      const throttled = base.lastReminder && now - base.lastReminder < POLICY.reminderThrottleHours * HOUR;
      notBooked.push({ ...base, canBook: g.ok, reason: g.ok ? 'Ready to book' : g.message, code: g.code ?? null, canRemind: g.ok && !throttled });
    }
  }
  booked.sort((a, b) => a.slot.startsAt - b.slot.startsAt);
  notBooked.sort((a, b) => (a.waitingSince ?? now) - (b.waitingSince ?? now));
  return { booked, notBooked, others, eligibleCount: booked.length + notBooked.length };
}

export const notificationsFor = (s, studentId) => s.notifications.filter((n) => n.studentId === studentId);
export const auditLog = (s, limit = 100) => s.audit.slice(0, limit);
export { parseIST };
