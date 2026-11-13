import { useMemo, useState } from 'react';
import * as E from './domain/engine.js';
import { POLICY } from './domain/rules.js';
import { DAY, dayKey, fmtDay, fmtDt, fmtTime, relative } from './domain/time.js';
import { BADGE } from './domain/seed.js';
import { studentView } from './domain/view.js';
import { act } from './store.js';
import { Btn, Card, Chip, Empty, Modal, Steps } from './ui.jsx';

export const go = (path) => { location.hash = path; };

export function Notifications({ view, readOnly }) {
  const n = view.notifications.slice(0, 5);
  return <Card title="Messages" aside={!readOnly && n.some((x) => !x.readAt) && <Btn kind="ghost" small onClick={() => act(E.markRead, { studentId: view.student.id })}>Mark read</Btn>}>
    {n.length ? n.map((m) => <div key={m.id} className={'msg' + (m.readAt ? '' : ' unread')}><b>{m.title}</b><p>{m.body}</p><small>{relative(m.createdAt, view.now)}</small></div>) : <Empty>No messages yet.</Empty>}</Card>;
}

export function MilesCard({ view }) {
  const m = view.miles, lb = view.leaderboard;
  return <Card title="Miles & leaderboard">
    <div className="miles"><div><small>Awarded</small><b>{m.awarded}</b></div><div><small>Pending interview</small><b className={m.pending ? 'pend' : ''}>{m.pending}</b></div></div>
    <p className="tier"><Chip tone={lb.tier === 'Qualiflyer' ? 'ok' : 'muted'}>{lb.tier}</Chip> {lb.note}</p>
    {view.state !== 'PASSED' && <p className="hint">{view.daysToDeadline} days left to earn your first badge (by {view.deadlineLabel}).</p>}
  </Card>;
}

export function StudentHome({ view, readOnly }) {
  const c = view.cta;
  return <div className="stack">
    <section className={'hero ' + view.tone}>
      <div className="plane" aria-hidden>✈</div>
      <Chip tone={view.tone}>{view.label}</Chip>
      <h1>{view.headline}</h1><p>{view.body}</p>
      <Steps steps={view.steps} />
      <div className="cta">
        <Btn disabled={readOnly || c.disabled} title={c.reason} onClick={() => c.route && go(c.route)}>{c.label}</Btn>
        {c.disabled && c.reason && <small>{c.reason}</small>}
      </div>
      {view.last?.interview?.notes && view.state !== 'PASSED' && <blockquote><b>Interviewer feedback</b>{view.last.interview.notes}</blockquote>}
    </section>
    <div className="grid2">
      <MilesCard view={view} />
      <Card title={`${BADGE.name} Badge skills`} aside={<Chip>{view.skillsDone}/{view.skills.length}</Chip>}>
        <ul className="skills">{view.skills.map((k) => <li key={k.skill} className={k.cleared ? 'ok' : ''}><i>{k.cleared ? '✓' : '○'}</i>{k.skill} <em>{k.level}</em></li>)}</ul>
      </Card>
    </div>
    <Notifications view={view} readOnly={readOnly} />
  </div>;
}

function SlotPicker({ s, studentId, onPick, busy }) {
  const slots = E.bookableSlots(s, studentId), recs = E.recommended(s, studentId);
  const days = useMemo(() => [...new Set(slots.map((x) => dayKey(x.startsAt)))], [slots.length]);
  const [day, setDay] = useState(null);
  const cur = day && days.includes(day) ? day : days[0];
  const byId = Object.fromEntries(slots.map((x) => [x.id, x]));
  if (!slots.length) return <Empty>No open slots with an interviewer you have not met. Ask the GRIT team to open more.</Empty>;
  return <>
    <h4 className="sub">✦ Recommended for you</h4>
    <div className="recs">{recs.map((r) => { const x = byId[r.slotId]; return <button key={r.slotId} className="rec" disabled={busy} onClick={() => onPick(x)}>
      <b>{fmtDay(x.startsAt)}</b><span>{fmtTime(x.startsAt)}</span><small>{x.interviewerName}</small><em>{r.reasons.join(' · ')}</em></button>; })}</div>
    <h4 className="sub">All open slots</h4>
    <div className="days">{days.map((d) => <button key={d} className={d === cur ? 'on' : ''} onClick={() => setDay(d)}>{fmtDay(slots.find((x) => dayKey(x.startsAt) === d).startsAt)}</button>)}</div>
    <div className="slots">{slots.filter((x) => dayKey(x.startsAt) === cur).map((x) => <button key={x.id} disabled={busy} onClick={() => onPick(x)}><b>{fmtTime(x.startsAt)}</b><small>{x.interviewerName}</small></button>)}</div>
  </>;
}

export function StudentBook({ s, studentId }) {
  const v = studentView(s, studentId); const [pick, setPick] = useState(null);
  if (!v.gate.ok) return <Card title="Book your interview"><Empty>{v.gate.message}</Empty>{v.state === 'BOOKED' && <Btn onClick={() => go('/student/interview')}>View my booking</Btn>}</Card>;
  const confirm = () => { const r = act(E.bookSlot, { studentId, slotId: pick.id }, 'Interview booked'); setPick(null); if (r.ok) go('/student/interview'); };
  return <Card title="Pick your interview slot" aside={<Chip>{POLICY.slotMinutes} min · online · IST</Chip>}>
    <p className="hint">You can pick slots from {POLICY.minLeadHours} hours to {POLICY.bookingWindowDays} days ahead. Changes are free until {POLICY.cancelCutoffHours} hours before.</p>
    <SlotPicker s={s} studentId={studentId} onPick={setPick} />
    {pick && <Modal title="Confirm your slot" onClose={() => setPick(null)} foot={<><Btn kind="ghost" onClick={() => setPick(null)}>Back</Btn><Btn onClick={confirm}>Confirm booking</Btn></>}>
      <div className="pass"><div><small>When</small><b>{fmtDt(pick.startsAt)}</b></div><div><small>Interviewer</small><b>{pick.interviewerName}</b></div><div><small>Format</small><b>Online · {POLICY.slotMinutes} min</b></div></div>
      <p className="hint">Keep your camera on and carry a valid ID. Cancel or reschedule until {fmtDt(pick.startsAt - POLICY.cancelCutoffHours * 3600000)}.</p></Modal>}
  </Card>;
}

const OUT = { pass: ['Passed', 'ok'], fail: ['Not cleared', 'bad'], retake: ['Retake later', 'warn'], no_show: ['No-show', 'warn'] };
export function StudentInterview({ s, studentId }) {
  const v = studentView(s, studentId); const [resched, setResched] = useState(false);
  return <div className="stack">
    {v.booking ? <Card title="Your boarding pass" aside={<Chip tone="info">Booked</Chip>} className="ticket">
      <div className="pass"><div><small>When</small><b>{fmtDt(v.slot.startsAt)}</b></div><div><small>Interviewer</small><b>{v.interviewer.name}</b></div><div><small>Badge</small><b>{BADGE.track} · {BADGE.name}</b></div>
        <div><small>Join link</small>{v.joinOpen ? <a href={v.booking.meetLink} onClick={(e) => e.preventDefault()}>{v.booking.meetLink}</a> : <b className="dim">Opens {fmtTime(v.joinOpensAt)} ({POLICY.joinOpensMinutes} min before)</b>}</div></div>
      <div className="row"><Btn disabled={!v.canChange} title={!v.canChange ? `Changes closed ${POLICY.cancelCutoffHours} hours before` : ''} onClick={() => setResched(true)}>Reschedule</Btn>
        <Btn kind="danger" disabled={!v.canChange} onClick={() => window.confirm('Cancel this interview?') && act(E.cancelBooking, { studentId, bookingId: v.booking.id }, 'Booking cancelled')}>Cancel</Btn>
        <small>{v.canChange ? `Free changes until ${fmtDt(v.changeUntil)}` : `Changes closed. Contact ${v.interviewer.name} for help.`}</small></div>
    </Card> : <Card title="No upcoming interview"><Empty>{v.gate.ok ? 'You have no booking yet.' : v.gate.message}</Empty>{v.gate.ok && <Btn onClick={() => go('/student/book')}>Book your interview</Btn>}</Card>}
    <Card title="Interview history">{v.history.length ? v.history.map((h) => <div key={h.booking.id} className="hist">
      <div><b>{fmtDt(h.slot.startsAt)}</b><small>{h.interviewer.name}</small></div>
      {h.interview ? <Chip tone={OUT[h.interview.outcome][1]}>{OUT[h.interview.outcome][0]}</Chip> : <Chip tone={h.booking.status === 'active' ? 'info' : 'muted'}>{h.booking.status.replaceAll('_', ' ')}</Chip>}
      {h.interview?.notes && <p>{h.interview.notes}</p>}</div>) : <Empty>Nothing yet.</Empty>}</Card>
    {resched && <Modal title="Reschedule interview" onClose={() => setResched(false)}><SlotPicker s={s} studentId={studentId} onPick={(x) => { const r = act(E.rescheduleBooking, { studentId, bookingId: v.booking.id, newSlotId: x.id }, 'Interview rescheduled'); if (r.ok) setResched(false); }} /></Modal>}
  </div>;
}

export function BadgeCard({ view }) {
  const m = { earned: ['Earned', 'ok', `Awarded ${view.student.badgeAwardedAt ? fmtDt(view.student.badgeAwardedAt) : ''}`], nullified: ['Nullified', 'bad', 'Removed after a malpractice review.'],
    ready: ['Interview pending', 'accent', 'Pass the interview to unlock this badge and its Miles.'], locked: ['Locked', 'muted', 'Clear every skill level to unlock the interview.'] }[view.badgeState];
  return <Card title={`${BADGE.track}`} aside={<Chip tone={m[1]}>{m[0]}</Chip>}>
    <div className={'badge ' + view.badgeState}><div className="medal">{view.badgeState === 'earned' ? '★' : view.badgeState === 'nullified' ? '✕' : '🔒'}</div><div><h2>{BADGE.name} Badge</h2><p>{m[2]}</p>
      <p className="hint">{view.badgeState === 'earned' ? `${BADGE.miles} Miles awarded` : view.badgeState === 'nullified' ? 'Miles removed' : `${BADGE.miles} Miles released on pass`} · Qualifying criteria: one badge by Dec 2026</p></div></div></Card>;
}
export const StudentBadges = ({ s, studentId }) => { const v = studentView(s, studentId); return <div className="stack"><BadgeCard view={v} /><MilesCard view={v} /></div>; };
void DAY;
