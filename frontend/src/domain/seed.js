// Demo data. Names are invented. Miles per badge is illustrative, not an official GRIT figure.
import * as M from './messages.js';
import { POLICY } from './rules.js';
import { DAY, HOUR, MIN, dayKey, istParts, parseIST } from './time.js';

export const TRACK = 'AI Product Mastery';
export const BADGE = { name: 'Novice', track: TRACK, miles: 450 };
export const SKILL_SET = [
  ['Computational Thinking', 'L1'], ['CS Fundamentals', 'L1'], ['Applied Gen AI Development', 'L1'], ['UI Engineering', 'L2'],
];
const WINDOWS = {
  iv_priya: { days: [1, 2, 3, 4, 5, 6], ranges: [['10:00', '13:00'], ['15:00', '18:00']] },
  iv_rahul: { days: [1, 2, 3, 4, 5], ranges: [['11:00', '14:00']] },
  iv_sana: { days: [1, 2, 3, 4, 5], ranges: [['16:00', '20:00']] },
};

export function seedState(now = Date.now()) {
  const s = {
    meta: { version: 1, seq: 100, clockOffsetMin: 0, seededAt: now }, interviewers: {}, students: {}, slots: {}, bookings: {},
    interviews: {}, notifications: [], audit: [],
  };
  const id = (p) => `${p}_${(s.meta.seq++).toString(36)}`;
  const iv = (key, name, tracks) => { s.interviewers[key] = { id: key, name, email: `${key.slice(3)}@interviews.example.com`, tracks }; };
  iv('iv_priya', 'Priya Nair', [TRACK, 'AI Systems Mastery']);
  iv('iv_rahul', 'Rahul Verma', [TRACK]);
  iv('iv_sana', 'Sana Qureshi', [TRACK, 'AI Models Mastery']);

  const today = dayKey(now);
  const dayAt = (off) => dayKey(now + off * DAY);
  const addSlot = (interviewerId, startsAt) => {
    const ex = Object.values(s.slots).find((x) => x.interviewerId === interviewerId && x.startsAt === startsAt);
    if (ex) return ex;
    const slot = { id: id('sl'), interviewerId, startsAt, endsAt: startsAt + POLICY.slotMinutes * MIN, status: 'open', createdAt: now - 20 * DAY };
    s.slots[slot.id] = slot; return slot;
  };
  for (let off = -3; off <= 14; off++) {
    const key = dayAt(off), dow = istParts(parseIST(key, '12:00')).dow;
    for (const [ivId, w] of Object.entries(WINDOWS)) {
      if (!w.days.includes(dow)) continue;
      for (const [a, b] of w.ranges) for (let t = parseIST(key, a); t + POLICY.slotMinutes * MIN <= parseIST(key, b); t += POLICY.slotMinutes * MIN) addSlot(ivId, t);
    }
  }

  const mkStudent = (sid, name, batch, state, cleared = SKILL_SET.length, extra = {}) => {
    s.students[sid] = {
      id: sid, name, email: `${sid.slice(4)}@niat.example.com`, batch, track: TRACK, badge: BADGE.name, state, failCount: 0, noShows: 0,
      nextEligibleAt: null, badgeAwardedAt: null, nullifiedAt: null, stateReason: null, createdAt: now - 60 * DAY,
      skills: SKILL_SET.map(([skill, level], i) => ({ skill, level, cleared: i < cleared })), ...extra,
    };
    return s.students[sid];
  };
  const note = (studentId, kind, msg, at) => s.notifications.push({ id: id('nt'), studentId, kind, title: msg[0], body: msg[1], createdAt: at, readAt: at + MIN });
  const book = (studentId, ivId, startsAt, status, createdAt) => {
    const slot = addSlot(ivId, startsAt); slot.status = 'booked';
    const b = { id: id('bk'), slotId: slot.id, studentId, badge: BADGE.name, status, meetLink: `https://meet.example.com/grit-${s.meta.seq}`, createdAt, cancelledAt: null };
    s.bookings[b.id] = b; return { b, slot };
  };
  const result = (b, slot, outcome, notes, retakeAfter = null) => {
    const r = { id: id('iv'), bookingId: b.id, interviewerId: slot.interviewerId, outcome, notes, retakeAfter, recordedAt: slot.endsAt + 5 * MIN, recordedBy: slot.interviewerId };
    s.interviews[r.id] = r; return r;
  };
  const eligibleSince = (sid, daysAgo) => note(sid, 'skills_completed', M.skills_completed(TRACK, BADGE.name), now - daysAgo * DAY);
  const at = (off, hhmm) => parseIST(dayAt(off), hhmm);

  // Eligible, not booked (the default student persona is Aarav)
  mkStudent('stu_aarav', 'Aarav Mehta', 2024, 'ELIGIBLE'); eligibleSince('stu_aarav', 2);
  mkStudent('stu_tanvi', 'Tanvi Rao', 2024, 'ELIGIBLE'); eligibleSince('stu_tanvi', 1);
  mkStudent('stu_harsh', 'Harsh Patel', 2023, 'ELIGIBLE'); eligibleSince('stu_harsh', 6);
  // Skills still in progress
  mkStudent('stu_diya', 'Diya Kapoor', 2025, 'NOT_ELIGIBLE', 3);
  mkStudent('stu_ritu', 'Ritu Sharma', 2025, 'NOT_ELIGIBLE', 2);
  // Booked
  const kab = book('stu_kabir', 'iv_priya', at(1, '11:00'), 'active', now - 3 * HOUR);
  mkStudent('stu_kabir', 'Kabir Singh', 2024, 'BOOKED');
  note('stu_kabir', 'booking_confirmed', M.booking_confirmed(TRACK, BADGE.name, kab.slot.startsAt, 'Priya Nair'), now - 3 * HOUR);
  const soon = Math.ceil((now + 40 * MIN) / (30 * MIN)) * 30 * MIN;
  const neh = book('stu_neha', 'iv_rahul', soon, 'active', now - DAY);
  mkStudent('stu_neha', 'Neha Joshi', 2024, 'BOOKED');
  note('stu_neha', 'booking_confirmed', M.booking_confirmed(TRACK, BADGE.name, neh.slot.startsAt, 'Rahul Verma'), now - DAY);
  const dev = book('stu_dev', 'iv_sana', at(-2, '17:00'), 'active', now - 4 * DAY);   // interview happened, outcome never recorded
  mkStudent('stu_dev', 'Dev Malhotra', 2023, 'BOOKED');
  // Results
  const mee = book('stu_meera', 'iv_priya', at(-3, '11:00'), 'completed', now - 6 * DAY);
  const meeI = result(mee.b, mee.slot, 'pass', 'Strong fundamentals and clear communication.');
  mkStudent('stu_meera', 'Meera Iyer', 2024, 'PASSED', 4, { badgeAwardedAt: meeI.recordedAt });
  note('stu_meera', 'result', M.result_pass(TRACK, BADGE.name), meeI.recordedAt);
  const roh = book('stu_rohan', 'iv_rahul', at(-2, '12:00'), 'completed', now - 5 * DAY);
  const rohI = result(roh.b, roh.slot, 'fail', 'Struggled to explain how an API request flows through the UI; revisit state management and error handling.');
  mkStudent('stu_rohan', 'Rohan Das', 2023, 'FAILED', 4, { failCount: 1, nextEligibleAt: rohI.recordedAt + POLICY.failCooldownDays * DAY });
  note('stu_rohan', 'result', M.result_fail(TRACK, BADGE.name, rohI.notes, s.students.stu_rohan.nextEligibleAt, 2), rohI.recordedAt);
  const sne = book('stu_sneha', 'iv_sana', at(-1, '16:30'), 'completed', now - 4 * DAY);
  const sneI = result(sne.b, sne.slot, 'retake', 'Solid UI work. Revisit prompt design and evaluation basics, then come back.');
  mkStudent('stu_sneha', 'Sneha Reddy', 2024, 'RETAKE_PENDING', 4, { nextEligibleAt: sneI.recordedAt + POLICY.retakeCooldownDays * DAY });
  note('stu_sneha', 'result', M.result_retake(TRACK, BADGE.name, sneI.notes, s.students.stu_sneha.nextEligibleAt), sneI.recordedAt);
  const vik = book('stu_vikram', 'iv_priya', at(-1, '10:30'), 'no_show', now - 3 * DAY);
  const vikI = result(vik.b, vik.slot, 'no_show', null);
  mkStudent('stu_vikram', 'Vikram Bose', 2025, 'RETAKE_PENDING', 4, { noShows: 1, nextEligibleAt: vikI.recordedAt + POLICY.noShowCooldownDays * DAY });
  note('stu_vikram', 'result', M.no_show(vik.slot.startsAt, s.students.stu_vikram.nextEligibleAt), vikI.recordedAt);
  // Flagged
  const ish = book('stu_ishaan', 'iv_priya', at(-3, '12:00'), 'completed', now - 9 * DAY);
  const ishI = result(ish.b, ish.slot, 'pass', 'Good answers across the board.');
  mkStudent('stu_ishaan', 'Ishaan Verma', 2023, 'NULLIFIED', 4, { nullifiedAt: now - DAY, stateReason: 'Answers were read from a hidden second screen during the interview.' });
  note('stu_ishaan', 'result', M.result_pass(TRACK, BADGE.name), ishI.recordedAt);
  note('stu_ishaan', 'nullified', M.nullified(TRACK, BADGE.name, s.students.stu_ishaan.stateReason), now - DAY);
  mkStudent('stu_ananya', 'Ananya Gupta', 2024, 'ON_HOLD', 4, { stateReason: 'Contest submission matched another student.' });
  note('stu_ananya', 'on_hold', M.on_hold(TRACK, BADGE.name), now - 2 * DAY);

  s.audit.push({ id: id('au'), at: now - 2 * DAY, role: 'team', actorId: 'team', action: 'FLAG_MALPRACTICE', entity: 'student', entityId: 'stu_ananya', detail: 'ELIGIBLE -> ON_HOLD: Contest submission matched another student.' });
  s.notifications.sort((a, b) => b.createdAt - a.createdAt);
  void today;
  return s;
}
