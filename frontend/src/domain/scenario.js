// Builds the before/after screens from the REAL engine (nothing is mocked): book -> interview time passes -> outcome.
import * as E from './engine.js';
import { seedState } from './seed.js';
import { MIN } from './time.js';
import { studentView } from './view.js';

const NOTES = { retake: 'Solid UI work. Revisit prompt design and evaluation basics, then come back.', fail: 'Could not explain how data flows from the API to the UI; revisit state management.' };
export function scenario(kind) {
  let s = E.tick(seedState()); const sid = 'stu_aarav';
  const slot = E.bookableSlots(s, sid)[0];
  const r = E.bookSlot(s, { studentId: sid, slotId: slot.id }); s = r.state;
  const before = { s, view: studentView(s, sid), team: E.teamOverview(s).booked.find((x) => x.student.id === sid) };
  s = E.advanceClock(s, { minutes: Math.ceil((slot.startsAt - E.nowOf(s)) / MIN) + 31 }).state;
  const outcome = kind === 'flag' ? 'pass' : kind;
  s = E.recordOutcome(s, { interviewerId: slot.interviewerId, bookingId: r.result, outcome, notes: NOTES[outcome] || '' }).state;
  if (kind === 'flag') s = E.flagMalpractice(s, { studentId: sid, reason: 'Answers were read from a hidden second screen.' }).state;
  const after = { s, view: studentView(s, sid), team: E.teamOverview(s).notBooked.find((x) => x.student.id === sid) || null };
  return { before, after };
}
