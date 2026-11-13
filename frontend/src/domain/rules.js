// Mirror of backend/app/rules.py (same codes, same messages, same numbers).
import { DAY, HOUR, MIN, fmtDate } from './time.js';

export class RuleError extends Error {
  constructor(code, message, status = 409) { super(message); this.name = 'RuleError'; this.code = code; this.status = status; }
}

export const OUTCOMES = ['pass', 'fail', 'retake', 'no_show'];
export const POLICY = Object.freeze({
  slotMinutes: 30, minLeadHours: 12, cancelCutoffHours: 6, retakeCooldownDays: 7, failCooldownDays: 14,
  noShowCooldownDays: 3, maxFails: 3, outcomeOverdueHours: 24, noShowGraceMinutes: 10, maxSlotsPerRequest: 24,
  notesMinChars: 10, joinOpensMinutes: 15, reminderThrottleHours: 24, bookingWindowDays: 14,
});

export function checkCanBook(student, slot, now, policy, priorInterviewerIds, hasActiveBooking) {
  const s = student.state;
  if (hasActiveBooking || s === 'BOOKED') throw new RuleError('ALREADY_BOOKED', 'You already have an interview booked. Cancel it first to pick another slot.');
  if (s === 'ON_HOLD') throw new RuleError('ON_HOLD', 'Your interview is on hold while the GRIT team reviews your account.', 403);
  if (s === 'NULLIFIED') throw new RuleError('NULLIFIED', 'This badge was nullified, so it cannot be booked.', 403);
  if (s === 'PASSED') throw new RuleError('ALREADY_PASSED', 'You have already cleared this badge interview.');
  if (s === 'NOT_ELIGIBLE') throw new RuleError('NOT_ELIGIBLE', 'Clear every skill level for this badge to unlock the interview.', 403);
  if (s === 'FAILED' || s === 'RETAKE_PENDING') {
    if (s === 'FAILED' && student.failCount >= policy.maxFails)
      throw new RuleError('MAX_ATTEMPTS', 'You have used all interview attempts for this badge. Please contact the GRIT team.', 403);
    const when = student.nextEligibleAt ? fmtDate(student.nextEligibleAt) : 'the cooldown date';
    throw new RuleError('COOLDOWN', `You can book again from ${when}.`);
  }
  if (s !== 'ELIGIBLE') throw new RuleError('WRONG_STATE', `Booking is not available while you are ${s}.`);

  if (slot.status !== 'open') throw new RuleError('SLOT_TAKEN', 'Someone just took this slot. Please pick another one.');
  if (slot.startsAt <= now) throw new RuleError('SLOT_PAST', 'This slot has already started.');
  if (slot.startsAt < now + policy.minLeadHours * HOUR) throw new RuleError('TOO_SOON', `Slots must be booked at least ${policy.minLeadHours} hours ahead.`);
  if (!slot.interviewerTracks.includes(student.track)) throw new RuleError('TRACK_MISMATCH', 'This interviewer does not assess your track.');
  if (priorInterviewerIds.has(slot.interviewerId)) throw new RuleError('SAME_INTERVIEWER', 'For a fair retake, please pick a different interviewer.');
}

export function checkCanCancel(startsAt, now, policy, by) {
  if (startsAt <= now) throw new RuleError('ALREADY_STARTED', 'This interview has already started.');
  if (by === 'student' && startsAt - now < policy.cancelCutoffHours * HOUR)
    throw new RuleError('CANCEL_TOO_LATE', `Changes close ${policy.cancelCutoffHours} hours before the interview. Please contact your interviewer.`);
}

export function checkCanRecord(startsAt, now, outcome, notes, retakeAfter, policy) {
  if (!OUTCOMES.includes(outcome)) throw new RuleError('BAD_OUTCOME', `Outcome must be one of ${OUTCOMES.join(', ')}.`, 422);
  if (outcome === 'no_show') {
    if (now < startsAt + policy.noShowGraceMinutes * MIN)
      throw new RuleError('NOSHOW_TOO_EARLY', `Wait ${policy.noShowGraceMinutes} minutes after the start before marking a no-show.`);
  } else if (now < startsAt) throw new RuleError('OUTCOME_TOO_EARLY', 'You can record the outcome once the interview has started.');
  if ((outcome === 'fail' || outcome === 'retake') && (notes || '').trim().length < policy.notesMinChars)
    throw new RuleError('NOTES_REQUIRED', `Add feedback of at least ${policy.notesMinChars} characters so the student knows what to improve.`, 422);
  if (retakeAfter != null) {
    if (outcome !== 'retake') throw new RuleError('BAD_RETAKE_DATE', 'A retake date only applies to a retake outcome.', 422);
    if (!(now + DAY <= retakeAfter && retakeAfter <= now + 60 * DAY))
      throw new RuleError('BAD_RETAKE_DATE', 'Retake date must be between 1 and 60 days from now.', 422);
  }
}

export function cooldownUntil(outcome, now, policy, noShows = 1, retakeAfter = null) {
  if (outcome === 'fail') return now + policy.failCooldownDays * DAY;
  if (outcome === 'retake') return retakeAfter ?? now + policy.retakeCooldownDays * DAY;
  if (outcome === 'no_show') return now + policy.noShowCooldownDays * Math.max(1, noShows) * DAY;
  return null;
}

export function slotGrid(start, end, now, policy) {
  const step = policy.slotMinutes * MIN;
  if (!(end > start)) throw new RuleError('BAD_RANGE', 'End time must be after the start time.', 422);
  if ((start + 330 * MIN) % step !== 0) throw new RuleError('BAD_RANGE', `Start time must be on a ${policy.slotMinutes}-minute mark.`, 422);
  if (start <= now) throw new RuleError('SLOT_PAST', 'Availability must start in the future.', 422);
  const starts = [];
  for (let t = start; t + step <= end; t += step) starts.push(t);
  if (!starts.length) throw new RuleError('BAD_RANGE', `The window must fit at least one ${policy.slotMinutes}-minute slot.`, 422);
  if (starts.length > policy.maxSlotsPerRequest) throw new RuleError('TOO_MANY_SLOTS', `Add at most ${policy.maxSlotsPerRequest} slots at a time.`, 422);
  return starts;
}
