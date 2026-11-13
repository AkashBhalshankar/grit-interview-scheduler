// View-models: everything a screen needs, derived from state. Screens never re-implement a rule.
import { bookableSlots, gate, nowOf, recommended, skillsComplete } from './engine.js';
import { POLICY } from './rules.js';
import { BADGE } from './seed.js';
import { S } from './states.js';
import { DAY, HOUR, MIN, fmtDate, fmtDay, fmtDt, parseIST } from './time.js';

const DEADLINE = parseIST('2026-12-31', '23:59');
export const STEP_LABELS = ['Skills cleared', 'Interview booked', 'Interview done', 'Badge awarded'];

export function studentView(s, studentId) {
  const st = s.students[studentId], now = nowOf(s);
  const active = Object.values(s.bookings).find((b) => b.studentId === studentId && b.status === 'active') || null;
  const slot = active ? s.slots[active.slotId] : null;
  const interviewer = slot ? s.interviewers[slot.interviewerId] : null;
  const history = Object.values(s.bookings).filter((b) => b.studentId === studentId).map((b) => ({
    booking: b, slot: s.slots[b.slotId], interviewer: s.interviewers[s.slots[b.slotId].interviewerId],
    interview: Object.values(s.interviews).find((i) => i.bookingId === b.id) || null,
  })).sort((a, b) => b.slot.startsAt - a.slot.startsAt);
  const last = history.find((h) => h.interview) || null;
  const g = gate(s, studentId);
  const cleared = st.skills.filter((k) => k.cleared).length, missing = st.skills.filter((k) => !k.cleared).map((k) => `${k.skill} ${k.level}`);
  const joinOpensAt = slot ? slot.startsAt - POLICY.joinOpensMinutes * MIN : null;
  const noShowLast = last?.interview?.outcome === 'no_show';

  const cfg = {
    NOT_ELIGIBLE: { label: 'Skills in progress', tone: 'muted', steps: ['current', 'todo', 'todo', 'todo'],
      headline: 'Keep clearing skills', body: `${cleared} of ${st.skills.length} skill levels cleared. Finish ${missing.join(', ') || 'the remaining levels'} to unlock your interview.`, cta: { label: 'Interview locked', disabled: true, reason: 'Clear every skill level first.' } },
    ELIGIBLE: { label: 'Ready to book', tone: 'accent', steps: ['done', 'current', 'todo', 'todo'],
      headline: "You're cleared to interview", body: `Pick a ${POLICY.slotMinutes}-minute slot with a ${st.track} interviewer. Your Miles and badge are released as soon as you pass.`, cta: { label: 'Book your interview', route: '/student/book' } },
    BOOKED: { label: 'Interview booked', tone: 'info', steps: ['done', 'done', 'current', 'todo'],
      headline: 'Your interview is booked', body: slot ? `${fmtDt(slot.startsAt)} with ${interviewer.name}. The join link opens ${POLICY.joinOpensMinutes} minutes before the start.` : '', cta: { label: 'View booking', route: '/student/interview' } },
    PASSED: { label: 'Badge unlocked', tone: 'ok', steps: ['done', 'done', 'done', 'done'],
      headline: `${BADGE.name} Badge unlocked`, body: `You cleared the ${st.track} ${st.badge} interview. ${BADGE.miles} Miles are now on your leaderboard score.`, cta: { label: 'View my badge', route: '/student/badges' } },
    FAILED: { label: 'Not cleared yet', tone: 'bad', steps: ['done', 'current', 'todo', 'todo'],
      headline: 'Not cleared this time', body: g.ok ? 'Your skills are safe. Read the feedback and book a new slot when you are ready.' : g.message, cta: g.ok ? { label: 'Book again', route: '/student/book' } : { label: 'Book again', disabled: true, reason: g.message } },
    RETAKE_PENDING: { label: noShowLast ? 'Interview missed' : 'Retake later', tone: 'warn', steps: ['done', 'current', 'todo', 'todo'],
      headline: noShowLast ? 'You missed your interview' : 'Retake later', body: g.ok ? 'You can book a new slot now.' : g.message, cta: g.ok ? { label: noShowLast ? 'Rebook' : 'Book your retake', route: '/student/book' } : { label: noShowLast ? 'Rebook' : 'Book your retake', disabled: true, reason: g.message } },
    NULLIFIED: { label: 'Badge nullified', tone: 'bad', steps: ['done', 'done', 'done', 'failed'],
      headline: 'Badge nullified', body: `Your ${st.badge} Badge was nullified after a malpractice review. Contact the GRIT team within 7 days if you think this is a mistake.`, cta: { label: 'Contact GRIT team', disabled: true, reason: 'Email the GRIT team to raise an appeal.' } },
    ON_HOLD: { label: 'Under review', tone: 'bad', steps: ['done', 'paused', 'todo', 'todo'],
      headline: 'Interview on hold', body: 'The GRIT team is reviewing your account. Booking is paused until the review is complete.', cta: { label: 'Booking paused', disabled: true, reason: 'The team will contact you.' } },
  }[st.state];

  const passed = st.state === S.PASSED;
  return {
    student: st, badge: BADGE, state: st.state, label: cfg.label, tone: cfg.tone, headline: cfg.headline, body: cfg.body, cta: cfg.cta,
    steps: STEP_LABELS.map((label, i) => ({ label, state: cfg.steps[i] })), skills: st.skills, skillsDone: cleared,
    booking: active, slot, interviewer, joinOpensAt, joinOpen: !!slot && now >= joinOpensAt && now < slot.endsAt,
    canChange: !!slot && slot.startsAt - now >= POLICY.cancelCutoffHours * HOUR, changeUntil: slot ? slot.startsAt - POLICY.cancelCutoffHours * HOUR : null,
    history, last, gate: g, now,
    miles: { pending: st.state === S.NULLIFIED ? 0 : passed ? 0 : BADGE.miles, awarded: passed ? BADGE.miles : 0, total: passed ? BADGE.miles : 0 },
    leaderboard: passed ? { tier: 'Qualiflyer', note: 'You have completed a track badge.' } : { tier: 'Pre-Qualiflyer', note: st.state === S.NULLIFIED ? 'Your badge was nullified, so you are back to Pre-Qualiflyer.' : 'Earn one badge to become a Qualiflyer.' },
    daysToDeadline: Math.max(0, Math.ceil((DEADLINE - now) / DAY)), deadlineLabel: fmtDate(DEADLINE),
    badgeState: { PASSED: 'earned', NULLIFIED: 'nullified' }[st.state] || (skillsComplete(st) ? 'ready' : 'locked'),
    notifications: s.notifications.filter((n) => n.studentId === studentId),
  };
}
export { bookableSlots, recommended, fmtDay };
