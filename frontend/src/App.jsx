import { useEffect, useMemo, useState } from 'react';
import * as E from './domain/engine.js';
import { scenario } from './domain/scenario.js';
import { dayKey, fmtDt } from './domain/time.js';
import { studentView } from './domain/view.js';
import { Availability, DemoSkills, Log, Schedule, Team } from './staff.jsx';
import { BadgeCard, StudentBadges, StudentBook, StudentHome, StudentInterview, go } from './student.jsx';
import { act, resetDemo, setUI, useApp } from './store.js';
import { Btn, Card, Chip, cx } from './ui.jsx';

const useHash = () => { const [h, setH] = useState(location.hash.slice(1) || '/student'); useEffect(() => { const f = () => setH(location.hash.slice(1) || '/student'); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []); return h; };
const ROLES = [['student', 'Student', '/student'], ['interviewer', 'Interviewer', '/interviewer'], ['team', 'Interview team', '/team'], ['compare', 'Before / after', '/compare']];
const NAV = { student: [['/student', 'Home'], ['/student/book', 'Book interview'], ['/student/interview', 'My interview'], ['/student/badges', 'Badges']], interviewer: [['/interviewer', 'Daily schedule'], ['/interviewer/availability', 'Availability']], team: [['/team', 'Overview'], ['/team/log', 'Audit log']], compare: [] };

function Compare() {
  const [kind, setKind] = useState('pass');
  const sc = useMemo(() => scenario(kind), [kind]);
  const T = { pass: 'Passed', retake: 'Retake later', fail: 'Not cleared', flag: 'Flagged later' };
  const Pair = ({ title, A, B }) => <div className="pair"><h3>{title}</h3><div className="grid2"><div><Chip tone="info">Before result</Chip><div className="frame">{A}</div></div><div><Chip tone={sc.after.view.tone}>After: {T[kind]}</Chip><div className="frame">{B}</div></div></div></div>;
  const row = (r, label) => r ? <div className="trow"><div><b>{r.student.name}</b><small>{label}</small></div>{r.slot ? <div className="r"><span>{fmtDt(r.slot.startsAt)}</span><small>{r.interviewer.name}</small></div> : <div className="r"><small>{r.reason}</small></div>}</div> : <p className="empty">Moves out of the eligible list{kind === 'pass' ? ' (badge awarded).' : '.'}</p>;
  return <div className="stack"><Card title="Same student, same screens, before and after the interview result" aside={<div className="seg">{Object.entries(T).map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div>}>
    <p className="hint">Every screen below is rendered by the real app code from real state: book, interview time passes, interviewer records the result.</p></Card>
    <Pair title="1. Student home" A={<StudentHome view={sc.before.view} readOnly />} B={<StudentHome view={sc.after.view} readOnly />} />
    <Pair title="2. Badges screen" A={<BadgeCard view={sc.before.view} />} B={<BadgeCard view={sc.after.view} />} />
    <Pair title="3. Interview team list" A={row(sc.before.team, 'Booked')} B={row(sc.after.team, kind === 'fail' ? 'Not booked · cooldown' : 'Not booked')} /></div>;
}

export default function App() {
  const { state: s, ui } = useApp(); const path = useHash();
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  const role = path.split('/')[1] || 'student';
  useEffect(() => { if (ROLES.some((r) => r[0] === role) && ui.role !== role) setUI({ role }); }, [role]);
  const [day, setDay] = useState(null);
  const iDay = day || E.nextSessionDay(s, ui.interviewerId);
  const now = E.nowOf(s), v = studentView(s, ui.studentId), unread = v.notifications.filter((n) => !n.readAt).length;
  const sub = '/' + path.split('/').slice(1).join('/');
  const body = role === 'student' ? (sub === '/student/book' ? <StudentBook s={s} studentId={ui.studentId} /> : sub === '/student/interview' ? <StudentInterview s={s} studentId={ui.studentId} /> : sub === '/student/badges' ? <StudentBadges s={s} studentId={ui.studentId} /> : <StudentHome view={v} />)
    : role === 'interviewer' ? (sub.endsWith('availability') ? <Availability s={s} interviewerId={ui.interviewerId} /> : <Schedule s={s} interviewerId={ui.interviewerId} day={iDay} setDay={setDay} />)
    : role === 'team' ? (sub.endsWith('log') ? <Log s={s} /> : <Team s={s} />) : <Compare />;
  return <>
    <header className="top"><div className="bar"><a className="logo" href="#/student"><span>GRIT</span><em>2026-27</em></a>
      <nav className="roles" aria-label="Switch role">{ROLES.map(([k, l, p]) => <a key={k} href={'#' + p} className={cx(role === k && 'on')}>{l}</a>)}</nav>
      <button onClick={toggleTheme} style={{all: 'unset', cursor: 'pointer', fontSize: '18px'}}>{theme === 'dark' ? '☀️' : '🌙'}</button>
      <div className="who">{role === 'student' && <select aria-label="View as student" value={ui.studentId} onChange={(e) => setUI({ studentId: e.target.value })}>{Object.values(s.students).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.state.replace('_', ' ').toLowerCase()}</option>)}</select>}
        {role === 'interviewer' && <select aria-label="View as interviewer" value={ui.interviewerId} onChange={(e) => { setUI({ interviewerId: e.target.value }); setDay(null); }}>{Object.values(s.interviewers).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}</div></div>
      {NAV[role].length > 0 && <div className="bar sub">{NAV[role].map(([p, l]) => <a key={p} href={'#' + p} className={cx(sub === p && 'on')}>{l}{p === '/student' && unread > 0 && <b className="dot">{unread}</b>}</a>)}</div>}</header>
    <main className="wrap">{role === 'team' && sub === '/team' && <></>}{body}
      {role === 'team' && sub === '/team' && <DemoSkills s={s} studentId={ui.studentId} />}</main>
    <footer className="demo"><span>Demo time <b>{fmtDt(now)}</b>{s.meta.clockOffsetMin ? <Chip tone="warn">+{Math.round(s.meta.clockOffsetMin / 60 * 10) / 10} h</Chip> : null}</span>
      <Btn kind="ghost" small onClick={() => act(E.advanceClock, { minutes: 60 })}>+1 hour</Btn><Btn kind="ghost" small onClick={() => act(E.advanceClock, { minutes: 1440 })}>+1 day</Btn>
      <Btn kind="ghost" small onClick={() => act(E.resetClock, {})}>Reset clock</Btn><Btn kind="ghost" small onClick={() => window.confirm('Reset all demo data?') && (resetDemo(), setDay(null))}>Reset demo data</Btn></footer>
    {ui.toast && <div className={'toast ' + ui.toast.tone} role="status">{ui.toast.msg}</div>}</>;
}
void go; void dayKey;
