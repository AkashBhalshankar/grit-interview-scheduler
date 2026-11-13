// Mirror of backend/app/messages.py. Parity is asserted by tests/parity.test.mjs against docs/parity.json.
import { POLICY } from './rules.js';
import { HOUR, fmtDate, fmtDt } from './time.js';

const nm = (track, badge) => `${track} ${badge}`;

export const booking_confirmed = (track, badge, startsAt, interviewer) => [
  'Interview booked',
  `You're booked! Your ${nm(track, badge)} interview is on ${fmtDt(startsAt)} with ${interviewer}. ` +
  `Your join link appears here ${POLICY.joinOpensMinutes} minutes before the start. Keep your camera on and carry a valid ID. ` +
  `You can reschedule until ${fmtDt(startsAt - POLICY.cancelCutoffHours * HOUR)}.`,
];
export const result_pass = (track, badge) => [
  'You passed!',
  `Cleared for takeoff! You passed the ${nm(track, badge)} interview. Your Miles and ${badge} Badge are now on your dashboard.`,
];
export const result_retake = (track, badge, notes, retakeOn) => {
  const d = fmtDate(retakeOn);
  return ['Retake later',
    `Not a pass yet, but you're close. Your interviewer has asked for a retake on or after ${d}. ` +
    `Feedback: "${notes}" Your cleared skills stay safe. You can book a new slot from ${d}, with a different interviewer.`];
};
export const result_fail = (track, badge, notes, retryOn, attemptsLeft) => [
  'Not cleared this time',
  `You didn't clear the ${nm(track, badge)} interview this time. Feedback: "${notes}" ` +
  `Your cleared skills stay safe. You can book again from ${fmtDate(retryOn)}. Attempts left: ${attemptsLeft}.`,
];
export const slot_released = (startsAt) => [
  'Your interview slot was cancelled',
  `Your interviewer can't make the ${fmtDt(startsAt)} slot, so it has been cancelled. ` +
  `This isn't your fault and it doesn't count as an attempt. Your booking is open again, so please pick a new slot.`,
];
export const cancelled_by_student = (startsAt) => ['Booking cancelled', `Your ${fmtDt(startsAt)} interview is cancelled. You can book a new slot any time.`];
export const no_show = (startsAt, retryOn) => [
  'Interview missed',
  `You missed your ${fmtDt(startsAt)} interview. You can book again from ${fmtDate(retryOn)}. Repeated no-shows increase the wait.`,
];
export const cooldown_over = (track, badge) => ['You can book again', `Your wait is over. Pick a new ${nm(track, badge)} interview slot from your dashboard.`];
export const skills_completed = (track, badge) => ['Interview unlocked', `All skills for the ${nm(track, badge)} Badge are cleared. Book your interview to claim it.`];
export const nullified = (track, badge, reason) => [
  'Badge nullified',
  `Your ${nm(track, badge)} Badge and its Miles have been nullified after a malpractice review. ` +
  `Reason: ${reason}. If you think this is a mistake, contact the GRIT team within 7 days.`,
];
export const on_hold = (track, badge) => [
  'Interview on hold',
  `Your ${nm(track, badge)} interview is on hold while the GRIT team reviews your account. Any booked slot has been released. The team will contact you.`,
];
export const reinstated = (track, badge) => ['Hold lifted', `The review is complete and your hold is lifted. You can book your ${nm(track, badge)} interview again.`];
export const overturned = (track, badge) => ['Badge restored', `Your appeal was upheld. Your ${nm(track, badge)} Badge and Miles are restored.`];
export const reminder = (track, badge, openSlots) => [
  'Time to book your interview',
  `You've cleared every skill for the ${nm(track, badge)} Badge. The last step is a quick interview, and ${openSlots} slots are open this week. Book one from your dashboard.`,
];
export const skill_invalidated = (track, badge, skill) => [
  'Interview on pause',
  `A result for ${skill} changed, so the ${nm(track, badge)} interview is paused. Any booked slot has been released. Clear the skill again to unlock your interview.`,
];
