import { useSyncExternalStore } from 'react';
import * as E from './domain/engine.js';
import { seedState } from './domain/seed.js';

const KEY = 'grit.demo.v2';
const safe = (f) => { try { return f(); } catch { return null; } };
const fresh = () => E.tick(seedState());
let state = safe(() => { const v = JSON.parse(localStorage.getItem(KEY)); return v?.meta?.version === 1 ? E.tick(v) : null; }) || fresh();
let ui = { role: 'student', studentId: 'stu_aarav', interviewerId: 'iv_priya', ...(safe(() => JSON.parse(localStorage.getItem(KEY + '.ui'))) || {}), toast: null };
let snap = { state, ui }; const subs = new Set();
const emit = () => { snap = { state, ui }; safe(() => { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem(KEY + '.ui', JSON.stringify(ui)); }); subs.forEach((f) => f()); };
export const useApp = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => snap);

let t;
export function toast(msg, tone = 'ok') { ui = { ...ui, toast: { msg, tone } }; emit(); clearTimeout(t); t = setTimeout(() => { ui = { ...ui, toast: null }; emit(); }, 4200); }
export const setUI = (p) => { ui = { ...ui, ...p }; emit(); };
export function act(fn, args, okMsg) {
  try { const r = fn(state, args); state = r.state; emit(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r.result) : okMsg); return { ok: true, result: r.result }; }
  catch (e) { if (e instanceof E.RuleError) { toast(e.message, 'bad'); return { ok: false, error: e }; } throw e; }
}
export const resetDemo = () => { state = fresh(); emit(); toast('Demo data reset'); };
setInterval(() => { state = E.tick(state); emit(); }, 30000);
