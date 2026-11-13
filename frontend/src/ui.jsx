import { useEffect } from 'react';
export const cx = (...a) => a.filter(Boolean).join(' ');
export const Btn = ({ kind = 'primary', small, disabled, title, children, ...p }) =>
  <button className={cx('btn', kind, small && 'sm')} disabled={disabled} title={title} {...p}>{children}</button>;
export const Chip = ({ tone = 'muted', children }) => <span className={cx('chip', tone)}>{children}</span>;
export const Card = ({ title, aside, children, className }) =>
  <section className={cx('card', className)}>{(title || aside) && <header><h3>{title}</h3>{aside}</header>}{children}</section>;
export function Modal({ title, onClose, children, foot }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="scrim" onClick={onClose}><div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
    <header><h3>{title}</h3><button className="x" onClick={onClose} aria-label="Close">×</button></header>{children}{foot && <footer>{foot}</footer>}</div></div>;
}
export const Steps = ({ steps }) => <ol className="steps">{steps.map((s, i) => <li key={i} className={s.state}><i>{s.state === 'done' ? '✓' : s.state === 'failed' ? '✕' : s.state === 'paused' ? 'II' : i + 1}</i><span>{s.label}</span></li>)}</ol>;
export const Empty = ({ children }) => <p className="empty">{children}</p>;
export const Field = ({ label, children }) => <label className="field"><span>{label}</span>{children}</label>;
