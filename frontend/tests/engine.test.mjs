import test from 'node:test'; import assert from 'node:assert/strict';
import * as E from '../src/domain/engine.js'; import { seedState } from '../src/domain/seed.js'; import { studentView } from '../src/domain/view.js'; import { MIN, HOUR, DAY } from '../src/domain/time.js';
const fresh = () => E.tick(seedState()), fails = (fn, code) => assert.throws(fn, (e) => e.code === code, code);
const slots = (s, id = 'stu_aarav') => E.bookableSlots(s, id);
const book = (s, studentId, slotId) => E.bookSlot(s, { studentId, slotId });
const jump = (s, slot, min = 31) => E.advanceClock(s, { minutes: Math.ceil((slot.endsAt - E.nowOf(s)) / MIN) + min - 30 }).state;

test('booking: eligible student books, state + slot + notification update together', () => {
  let s = fresh(); const sl = slots(s)[0]; const r = book(s, 'stu_aarav', sl.id); s = r.state;
  assert.equal(s.students.stu_aarav.state, 'BOOKED'); assert.equal(s.slots[sl.id].status, 'booked');
  assert.match(s.notifications[0].body, /^You're booked!/);
});
test('double booking: second student on the same slot is refused and nothing changes', () => {
  let s = fresh(); const sl = slots(s)[0]; s = book(s, 'stu_aarav', sl.id).state; const before = JSON.stringify(s);
  fails(() => book(s, 'stu_tanvi', sl.id), 'SLOT_TAKEN'); assert.equal(JSON.stringify(s), before);
});
test('a student cannot hold two bookings', () => {
  let s = fresh(); const [a, b] = slots(s); s = book(s, 'stu_aarav', a.id).state; fails(() => book(s, 'stu_aarav', b.id), 'ALREADY_BOOKED');
});
test('eligibility gates: not eligible, on hold, passed, nullified cannot book', () => {
  const s = fresh(), id = slots(s)[0].id;
  for (const [stu, code] of [['stu_diya', 'NOT_ELIGIBLE'], ['stu_ananya', 'ON_HOLD'], ['stu_meera', 'ALREADY_PASSED'], ['stu_ishaan', 'NULLIFIED'], ['stu_rohan', 'COOLDOWN']]) fails(() => book(s, stu, id), code);
});
test('lead time and window are enforced', () => {
  const s = fresh(), soon = Object.values(s.slots).find((x) => x.status === 'open' && x.startsAt > E.nowOf(s) && x.startsAt < E.nowOf(s) + 6 * HOUR);
  if (soon) fails(() => book(s, 'stu_aarav', soon.id), 'TOO_SOON');
  const far = Object.values(s.slots).find((x) => x.startsAt > E.nowOf(s) + 15 * DAY); if (far) assert.ok(!slots(s).some((x) => x.id === far.id));
});
test('cancel: allowed before the cutoff, refused inside it, slot is released', () => {
  let s = fresh(); const sl = slots(s)[0]; const bid = (s = book(s, 'stu_aarav', sl.id).state, Object.keys(s.bookings).pop());
  s = E.cancelBooking(s, { studentId: 'stu_aarav', bookingId: bid }).state; assert.equal(s.students.stu_aarav.state, 'ELIGIBLE'); assert.equal(s.slots[sl.id].status, 'open');
  fails(() => E.cancelBooking(s, { studentId: 'stu_neha', bookingId: Object.values(s.bookings).find((b) => b.studentId === 'stu_neha').id }), 'CANCEL_TOO_LATE');
});
test('reschedule is atomic: a failing swap keeps the old booking', () => {
  let s = fresh(); const [a, b] = slots(s); const r = book(s, 'stu_aarav', a.id); s = r.state;
  s = book(s, 'stu_tanvi', b.id).state; const before = JSON.stringify(s);
  fails(() => E.rescheduleBooking(s, { studentId: 'stu_aarav', bookingId: r.result, newSlotId: b.id }), 'SLOT_TAKEN');
  assert.equal(JSON.stringify(s), before);
  const c = slots(s).find((x) => x.id !== a.id && x.id !== b.id); const s2 = E.rescheduleBooking(s, { studentId: 'stu_aarav', bookingId: r.result, newSlotId: c.id }).state;
  assert.equal(s2.slots[a.id].status, 'open'); assert.equal(s2.slots[c.id].status, 'booked'); assert.equal(s2.students.stu_aarav.state, 'BOOKED');
});
test('outcomes: pass awards the badge; fail/retake need feedback and set cooldowns; no-show needs grace time', () => {
  let s = fresh(); const sl = slots(s)[0]; const r = book(s, 'stu_aarav', sl.id); s = r.state; const rec = (o, extra = {}) => ({ interviewerId: sl.interviewerId, bookingId: r.result, outcome: o, ...extra });
  fails(() => E.recordOutcome(s, rec('pass')), 'OUTCOME_TOO_EARLY'); s = jump(s, sl);
  fails(() => E.recordOutcome(s, rec('fail', { notes: 'short' })), 'NOTES_REQUIRED');
  fails(() => E.recordOutcome(s, { ...rec('pass'), interviewerId: 'iv_other' }), 'NOT_FOUND' === 'x' ? 'x' : 'FORBIDDEN');
  const pass = E.recordOutcome(s, rec('pass')).state; assert.equal(pass.students.stu_aarav.state, 'PASSED'); assert.ok(pass.students.stu_aarav.badgeAwardedAt);
  fails(() => E.recordOutcome(pass, rec('pass')), 'ALREADY_RECORDED');
  const fail = E.recordOutcome(s, rec('fail', { notes: 'Needs work on state management.' })).state.students.stu_aarav; assert.equal(fail.state, 'FAILED'); assert.equal(fail.failCount, 1);
  const retake = E.recordOutcome(s, rec('retake', { notes: 'Close, revisit evaluation basics.' })).state; assert.equal(retake.students.stu_aarav.state, 'RETAKE_PENDING');
  assert.match(retake.notifications[0].body, /^Not a pass yet/);
});
test('cooldown ends by itself and a retake needs a different interviewer', () => {
  let s = fresh(); const sl = slots(s)[0]; const r = book(s, 'stu_aarav', sl.id); s = jump(r.state, sl);
  s = E.recordOutcome(s, { interviewerId: sl.interviewerId, bookingId: r.result, outcome: 'retake', notes: 'Close, revisit evaluation basics.' }).state;
  assert.equal(studentView(s, 'stu_aarav').gate.ok, false);
  s = E.advanceClock(s, { minutes: 8 * 1440 }).state; assert.equal(s.students.stu_aarav.state, 'ELIGIBLE');
  assert.ok(slots(s).every((x) => x.interviewerId !== sl.interviewerId), 'previous interviewer hidden');
  fails(() => book(s, 'stu_aarav', Object.values(s.slots).find((x) => x.interviewerId === sl.interviewerId && x.status === 'open' && x.startsAt > E.nowOf(s) + 13 * HOUR).id), 'SAME_INTERVIEWER');
});
test('max attempts blocks until the team grants one', () => {
  let s = fresh(); s.students.stu_rohan.failCount = 3; s.students.stu_rohan.nextEligibleAt = E.nowOf(s) - 1;
  s = E.tick(s); assert.equal(s.students.stu_rohan.state, 'FAILED'); fails(() => book(s, 'stu_rohan', slots(s, 'stu_rohan')[0].id), 'MAX_ATTEMPTS');
  s = E.grantAttempt(s, { studentId: 'stu_rohan' }).state; assert.equal(s.students.stu_rohan.state, 'ELIGIBLE');
});
test('interviewer cancels a booked slot: student released, notified, no attempt counted', () => {
  let s = fresh(); const sl = Object.values(s.slots).find((x) => x.status === 'booked' && x.startsAt > E.nowOf(s) + 12 * HOUR);
  const iv = sl.interviewerId; s = E.cancelSlot(s, { interviewerId: iv, slotId: sl.id }).state;
  const st = Object.values(s.students).find((x) => x.name.startsWith('Kabir')); assert.equal(st.state, 'ELIGIBLE'); assert.equal(s.slots[sl.id].status, 'cancelled'); assert.match(s.notifications[0].body, /can't make the/);
});
test('availability: validates, never duplicates, reopens closed slots', () => {
  let s = fresh(); const day = new Date(E.nowOf(s) + 20 * DAY).toISOString().slice(0, 10), t = (h) => Date.parse(`${day}T${h}:00+05:30`);
  const r = E.addAvailability(s, { interviewerId: 'iv_rahul', start: t('15:00'), end: t('17:00') }); assert.equal(r.result.created, 4);
  assert.equal(E.addAvailability(r.state, { interviewerId: 'iv_rahul', start: t('15:00'), end: t('17:00') }).result.skipped, 4);
  fails(() => E.addAvailability(s, { interviewerId: 'iv_rahul', start: t('15:10'), end: t('17:00') }), 'BAD_RANGE'); fails(() => E.addAvailability(s, { interviewerId: 'iv_rahul', start: E.nowOf(s) - HOUR, end: E.nowOf(s) + HOUR }), 'BAD_RANGE');
});
test('malpractice: pass is nullified; booked student is put on hold and slot freed; reinstate and overturn work', () => {
  let s = fresh(); s = E.flagMalpractice(s, { studentId: 'stu_meera', reason: 'Second screen used' }).state; assert.equal(s.students.stu_meera.state, 'NULLIFIED'); assert.equal(s.students.stu_meera.badgeAwardedAt, null);
  assert.equal(studentView(s, 'stu_meera').miles.awarded, 0);
  s = E.overturn(s, { studentId: 'stu_meera' }).state; assert.equal(s.students.stu_meera.state, 'PASSED');
  const k = s.students.stu_kabir, slot = Object.values(s.bookings).find((b) => b.studentId === k.id && b.status === 'active').slotId;
  s = E.flagMalpractice(s, { studentId: 'stu_kabir', reason: 'Contest plagiarism' }).state; assert.equal(s.students.stu_kabir.state, 'ON_HOLD'); assert.equal(s.slots[slot].status, 'open');
  s = E.reinstate(s, { studentId: 'stu_kabir' }).state; assert.equal(s.students.stu_kabir.state, 'ELIGIBLE');
  fails(() => E.flagMalpractice(s, { studentId: 'stu_ananya', reason: 'again please' }), 'ILLEGAL_TRANSITION'); fails(() => E.flagMalpractice(s, { studentId: 'stu_aarav', reason: 'no' }), 'BAD_REASON');
});
test('skill invalidated pauses a booked student and clearing it unlocks again', () => {
  let s = fresh(); s = book(s, 'stu_aarav', slots(s)[0].id).state; s = E.setSkill(s, { studentId: 'stu_aarav', skill: 'UI Engineering', level: 'L2', cleared: false }).state;
  assert.equal(s.students.stu_aarav.state, 'NOT_ELIGIBLE'); assert.ok(!Object.values(s.bookings).some((b) => b.studentId === 'stu_aarav' && b.status === 'active'));
  s = E.setSkill(s, { studentId: 'stu_aarav', skill: 'UI Engineering', level: 'L2', cleared: true }).state; assert.equal(s.students.stu_aarav.state, 'ELIGIBLE');
});
test('team overview splits eligible students into booked / not booked; reminders are throttled', () => {
  let s = fresh(); let o = E.teamOverview(s); assert.equal(o.eligibleCount, o.booked.length + o.notBooked.length); assert.ok(o.booked.some((r) => r.overdue)); assert.ok(o.notBooked.some((r) => r.canBook));
  s = E.sendReminder(s, { studentId: 'stu_aarav' }).state; fails(() => E.sendReminder(s, { studentId: 'stu_aarav' }), 'REMINDER_THROTTLED'); fails(() => E.sendReminder(s, { studentId: 'stu_rohan' }), 'NOT_REMINDABLE');
  s = book(s, 'stu_aarav', slots(s)[0].id).state; o = E.teamOverview(s); assert.ok(o.booked.some((r) => r.student.id === 'stu_aarav'));
});
test('before/after: same student, home view changes with each result', () => {
  const labels = {};
  for (const [o, notes] of [['pass', ''], ['retake', 'Close, revisit evaluation basics.'], ['fail', 'Needs work on state management.']]) {
    let s = fresh(); const sl = slots(s)[0]; const r = book(s, 'stu_aarav', sl.id); s = jump(r.state, sl);
    s = E.recordOutcome(s, { interviewerId: sl.interviewerId, bookingId: r.result, outcome: o, notes }).state; labels[o] = studentView(s, 'stu_aarav').label;
  }
  assert.deepEqual(labels, { pass: 'Badge unlocked', retake: 'Retake later', fail: 'Not cleared yet' });
});
