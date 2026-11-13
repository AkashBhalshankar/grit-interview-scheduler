import { useState } from 'react';
import * as E from './domain/engine.js';
import { POLICY } from './domain/rules.js';
import { DAY, addDays, dayKey, fmtDay, fmtDt, fmtTime, hhmm, parseIST, relative } from './domain/time.js';
import { act, toast } from './store.js';
import { Btn, Card, Chip, Empty, Field, Modal } from './ui.jsx';

// ---------------------------------------------------------------- interviewer
export function Availability({ s, interviewerId }) {
  const now = E.nowOf(s), tomorrow = dayKey(now + DAY);
  const [f, setF] = useState({ date: tomorrow, from: '10:00', to: '12:00' });
  const slots = Object.values(s.slots).filter((x) => x.interviewerId === interviewerId && x.endsAt > now && x.startsAt < now + 8 * DAY).sort((a, b) => a.startsAt - b.startsAt);
  const days = [...new Set(slots.map((x) => dayKey(x.startsAt)))];
  const add = () => act(E.addAvailability, { interviewerId, start: parseIST(f.date, f.from), end: parseIST(f.date, f.to) }, (r) => `${r.created} slot(s) added${r.skipped ? `, ${r.skipped} already open` : ''}`);
  return <div className="stack"><Card title="Add availability" aside={<Chip>{POLICY.slotMinutes}-min slots</Chip>}>
    <div className="form"><Field label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="From"><input type="time" step="1800" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
      <Field label="To"><input type="time" step="1800" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field><Btn onClick={add}>Add slots</Btn></div>
    <p className="hint">Up to {POLICY.maxSlotsPerRequest} slots at a time. Existing slots are never duplicated.</p></Card>
    <Card title="Your next 7 days">{days.length ? days.map((d) => <div key={d} className="dayrow"><h4>{fmtDay(slots.find((x) => dayKey(x.startsAt) === d).startsAt)}</h4><div className="chips">
      {slots.filter((x) => dayKey(x.startsAt) === d).map((x) => { const b = Object.values(s.bookings).find((k) => k.slotId === x.id && k.status === 'active');
        return <button key={x.id} className={'slotchip ' + (x.status === 'cancelled' ? 'closed' : x.status)} title={b ? `Booked by ${s.students[b.studentId].name}. Click to release.` : x.status === 'open' ? 'Click to close' : 'Closed'}
          disabled={x.status === 'cancelled'} onClick={() => (!b || window.confirm(`Release ${s.students[b.studentId].name}'s booking? They will be notified.`)) && act(E.cancelSlot, { interviewerId, slotId: x.id }, (r) => r.released ? 'Slot closed and student notified' : 'Slot closed')}>
          {fmtTime(x.startsAt)}{b && <small> · {s.students[b.studentId].name.split(' ')[0]}</small>}</button>; })}</div></div>) : <Empty>No slots yet. Add some above.</Empty>}</Card></div>;
}

const KIND = { open: ['Open', 'muted'], booked: ['Booked', 'info'], completed: ['Done', 'ok'], no_show: ['No-show', 'warn'], closed: ['Closed', 'muted'] };
export function Schedule({ s, interviewerId, day, setDay }) {
  const rows = E.interviewerDay(s, interviewerId, day), now = E.nowOf(s); const [rec, setRec] = useState(null);
  const shown = rows.filter((r) => r.kind !== 'open' && r.kind !== 'closed'), open = rows.filter((r) => r.kind === 'open').length;
  return <div className="stack"><Card title="Daily schedule" aside={<div className="row"><Btn kind="ghost" small onClick={() => setDay(addDays(day, -1))}>‹</Btn><b>{fmtDay(parseIST(day, '12:00'))}</b><Btn kind="ghost" small onClick={() => setDay(addDays(day, 1))}>›</Btn>
    <Btn kind="ghost" small onClick={() => setDay(E.nextSessionDay(s, interviewerId))}>Next session</Btn></div>}>
    {shown.length ? shown.map((r) => <div key={r.slot.id} className={'sess ' + r.kind}>
      <div className="time"><b>{fmtTime(r.slot.startsAt)}</b><small>{fmtTime(r.slot.endsAt)}</small></div>
      <div className="person"><b>{r.student?.name ?? '—'}</b><small>{r.student ? `Batch ${r.student.batch} · ${r.student.track}` : ''}</small>{r.interview?.notes && <p>{r.interview.notes}</p>}</div>
      <div className="act"><Chip tone={KIND[r.kind][1]}>{KIND[r.kind][0]}</Chip>{r.overdue && <Chip tone="bad">Outcome overdue</Chip>}
        {r.booking?.status === 'active' && <Btn small disabled={!r.canRecord} title={!r.canRecord ? `Opens at ${fmtTime(r.recordOpensAt)}. Use the demo clock to jump ahead.` : ''} onClick={() => setRec(r)}>Record outcome</Btn>}
        {r.interview && <Chip tone={{ pass: 'ok', fail: 'bad', retake: 'warn', no_show: 'warn' }[r.interview.outcome]}>{r.interview.outcome.replace('_', ' ')}</Chip>}</div></div>)
      : <Empty>No interviews on this day.{open ? ` ${open} open slot(s) unbooked.` : ''}</Empty>}
    {shown.length > 0 && open > 0 && <p className="hint">{open} more slot(s) still open.</p>}</Card>
    {rec && <Outcome s={s} row={rec} interviewerId={interviewerId} now={now} onClose={() => setRec(null)} />}</div>;
}

function Outcome({ row, interviewerId, now, onClose }) {
  const [o, setO] = useState('pass'), [notes, setNotes] = useState(''), [days, setDays] = useState(7);
  const need = o === 'fail' || o === 'retake', canNoShow = now >= row.noShowOpensAt;
  const save = () => { const r = act(E.recordOutcome, { interviewerId, bookingId: row.booking.id, outcome: o, notes, retakeAfter: o === 'retake' ? now + days * DAY + 60000 : null }, 'Outcome saved. The student has been notified.'); if (r.ok) onClose(); };
  return <Modal title={`Outcome: ${row.student.name}`} onClose={onClose} foot={<><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save}>Save outcome</Btn></>}>
    <div className="seg">{[['pass', 'Pass'], ['retake', 'Retake later'], ['fail', 'Fail'], ['no_show', 'No-show']].map(([k, l]) => <button key={k} className={o === k ? 'on ' + k : ''} onClick={() => setO(k)} disabled={k === 'no_show' && !canNoShow} title={k === 'no_show' && !canNoShow ? `Wait ${POLICY.noShowGraceMinutes} min after the start` : ''}>{l}</button>)}</div>
    {o === 'retake' && <Field label="Earliest retake (days from now)"><input type="number" min="1" max="60" value={days} onChange={(e) => setDays(+e.target.value)} /></Field>}
    {o !== 'no_show' && <Field label={need ? `Feedback for the student (required, min ${POLICY.notesMinChars} characters)` : 'Feedback (optional)'}><textarea rows="4" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What went well, what to improve" /></Field>}
    <p className="hint">{{ pass: 'Awards the badge and Miles immediately.', retake: 'Student keeps their skills and rebooks with a different interviewer after the date.', fail: `Starts a ${POLICY.failCooldownDays}-day wait. ${POLICY.maxFails} attempts in total.`, no_show: 'Counts as an attempt only for the wait time, not as a fail.' }[o]}</p></Modal>;
}

// ---------------------------------------------------------------- interview team
export function Team({ s }) {
  const o = E.teamOverview(s), now = E.nowOf(s), [flag, setFlag] = useState(null), [reason, setReason] = useState('');
  const remind = async (st) => {
    const base = window.GRIT_CONFIG?.apiUrl; let body = null;
    if (base) { try { const r = await fetch(`${base}/api/ai/reminder`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ student_id: st.id }) }); body = (await r.json()).body; } catch { /* template fallback */ } }
    act(E.sendReminder, { studentId: st.id, body }, 'Reminder sent');
  };
  const remindAll = () => { const ids = o.notBooked.filter((r) => r.canRemind).map((r) => r.student.id); let n = 0; for (const id of ids) if (act(E.sendReminder, { studentId: id }).ok) n++; toast(`${n} reminder(s) sent`); };
  const pct = o.eligibleCount ? Math.round((o.booked.length / o.eligibleCount) * 100) : 0;
  return <div className="stack">
    <div className="stats"><div><b>{o.eligibleCount}</b><small>Eligible students</small></div><div><b>{o.booked.length}</b><small>Booked ({pct}%)</small></div><div><b>{o.notBooked.length}</b><small>Not booked</small></div><div><b>{o.booked.filter((r) => r.overdue).length}</b><small>Outcomes overdue</small></div></div>
    <div className="grid2 top">
      <Card title="Booked" aside={<Chip tone="ok">{o.booked.length}</Chip>}>{o.booked.length ? o.booked.map((r) => <div key={r.student.id} className="trow"><div><b>{r.student.name}</b><small>Batch {r.student.batch}</small></div>
        <div className="r"><span>{fmtDt(r.slot.startsAt)}</span><small>{r.interviewer.name}</small></div>{r.overdue ? <Chip tone="bad">Outcome overdue</Chip> : r.awaitingOutcome ? <Chip tone="warn">Awaiting outcome</Chip> : <Chip tone="info">{relative(r.slot.startsAt, now)}</Chip>}</div>) : <Empty>Nobody booked yet.</Empty>}</Card>
      <Card title="Not booked" aside={<Btn small disabled={!o.notBooked.some((r) => r.canRemind)} onClick={remindAll}>Remind all</Btn>}>{o.notBooked.length ? o.notBooked.map((r) => <div key={r.student.id} className="trow"><div><b>{r.student.name}</b><small>{r.waitingSince ? `Waiting ${relative(r.waitingSince, now).replace(' ago', '')}` : 'Eligible'} · Batch {r.student.batch}</small></div>
        <div className="r"><Chip tone={r.canBook ? 'accent' : 'warn'}>{r.canBook ? 'Ready to book' : r.student.state === 'FAILED' ? 'Failed · cooldown' : 'Retake · cooldown'}</Chip>{!r.canBook && <small>{r.reason}</small>}</div>
        {r.canBook ? <Btn small disabled={!r.canRemind} title={!r.canRemind ? `Reminded ${relative(r.lastReminder, now)}` : ''} onClick={() => remind(r.student)}>Remind</Btn> : <Btn small kind="ghost" onClick={() => act(E.grantAttempt, { studentId: r.student.id }, 'Booking re-opened')}>Allow now</Btn>}</div>) : <Empty>Everyone eligible has booked.</Empty>}</Card></div>
    <Card title="Everyone else">{Object.keys(o.others).length ? <div className="chips">{Object.entries(o.others).map(([k, n]) => <Chip key={k} tone={k === 'PASSED' ? 'ok' : k === 'NOT_ELIGIBLE' ? 'muted' : 'bad'}>{k.replace('_', ' ').toLowerCase()} · {n}</Chip>)}</div> : <Empty>None.</Empty>}
      <div className="exc">{Object.values(s.students).map((st) => <div key={st.id} className="trow slim"><div><b>{st.name}</b><small>{st.state.replace('_', ' ').toLowerCase()}{st.stateReason ? ` · ${st.stateReason}` : ''}</small></div><div className="row">
        {['PASSED', 'ELIGIBLE', 'BOOKED', 'FAILED', 'RETAKE_PENDING', 'NOT_ELIGIBLE'].includes(st.state) && <Btn small kind="danger" onClick={() => setFlag(st)}>Flag malpractice</Btn>}
        {st.state === 'ON_HOLD' && <Btn small onClick={() => act(E.reinstate, { studentId: st.id }, 'Hold lifted')}>Reinstate</Btn>}
        {st.state === 'NULLIFIED' && <Btn small onClick={() => act(E.overturn, { studentId: st.id }, 'Badge restored')}>Overturn</Btn>}</div></div>)}</div></Card>
    {flag && <Modal title={`Flag ${flag.name}`} onClose={() => setFlag(null)} foot={<><Btn kind="ghost" onClick={() => setFlag(null)}>Cancel</Btn><Btn kind="danger" onClick={() => { if (act(E.flagMalpractice, { studentId: flag.id, reason }, flag.state === 'PASSED' ? 'Badge nullified' : 'Student put on hold').ok) { setFlag(null); setReason(''); } }}>Confirm flag</Btn></>}>
      <p className="hint">{flag.state === 'PASSED' ? 'This nullifies the badge and removes its Miles.' : 'This puts the student on hold and releases any booked slot.'} The student is notified and the action is logged.</p>
      <Field label="Reason (shown to the student)"><textarea rows="3" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></Modal>}
  </div>;
}

export function Log({ s }) { return <Card title="Audit log">{E.auditLog(s, 60).map((a) => <div key={a.id} className="trow slim"><div><b>{a.action}</b><small>{a.role} · {a.entity} {a.entityId}{a.detail ? ` · ${a.detail}` : ''}</small></div><small>{fmtDt(a.at)}</small></div>)}</Card>; }

export function DemoSkills({ s, studentId }) {
  const st = s.students[studentId];
  return <Card title="Demo: simulate a contest result">
    <p className="hint">Skill results normally come from the contest system. Toggle one to watch the interview unlock or pause.</p>
    <div className="chips">{st.skills.map((k) => <button key={k.skill} className={'slotchip ' + (k.cleared ? 'open' : 'closed')} onClick={() => act(E.setSkill, { studentId, skill: k.skill, level: k.level, cleared: !k.cleared }, k.cleared ? 'Skill invalidated' : 'Skill cleared')}>{k.cleared ? '✓' : '○'} {k.skill} {k.level}</button>)}</div></Card>;
}
void hhmm;
