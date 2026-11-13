import { useSyncExternalStore } from 'react';
import * as E from './domain/engine.js';
import { seedState } from './domain/seed.js';

const KEY = 'grit.demo.v2';
const UI_KEY = 'grit.ui';
const safe = (f) => { try { return f(); } catch { return null; } };

const getApiBase = () => {
  // 1. Check runtime window overrides first (if defined via config.js or Docker)
  if (typeof window !== 'undefined') {
    if (window.VITE_API_URL) return window.VITE_API_URL;
    if (window.GRIT_CONFIG?.apiUrl) return window.GRIT_CONFIG.apiUrl;
  }

  // 2. Check Vite build-time environment variables (injected by Vercel from .env.production)
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // 3. Final fallback for local development
  return "http://localhost:8000";
};

let ui = {
  role: 'student',
  studentId: 'stu_aarav',
  interviewerId: 'iv_priya',
  ...(safe(() => JSON.parse(localStorage.getItem(UI_KEY + '.ui'))) || {}),
  toast: null
};

let state = safe(() => {
  const v = JSON.parse(localStorage.getItem(KEY));
  return v?.meta?.version === 1 ? E.tick(v) : null;
}) || E.tick(seedState());

let snap = { state, ui };
const subs = new Set();

const emit = () => {
  snap = { state, ui };
  safe(() => {
    localStorage.setItem(KEY, JSON.stringify(state));
    localStorage.setItem(UI_KEY + '.ui', JSON.stringify(ui));
  });
  subs.forEach((f) => f());
};

export const useApp = () => useSyncExternalStore(
  (f) => { subs.add(f); return () => subs.delete(f); },
  () => snap
);

let t;
export function toast(msg, tone = 'ok') {
  ui = { ...ui, toast: { msg, tone } };
  emit();
  clearTimeout(t);
  t = setTimeout(() => {
    ui = { ...ui, toast: null };
    emit();
  }, 4200);
}

export const setUI = (p) => {
  ui = { ...ui, ...p };
  emit();
  refreshState();
};

export async function refreshState() {
  const base = getApiBase();
  let url = '';
  if (ui.role === 'student') {
    url = `${base}/api/students/${ui.studentId}/dashboard`;
  } else if (ui.role === 'team') {
    url = `${base}/api/team/overview`;
  } else if (ui.role === 'interviewer') {
    const todayStr = new Date().toISOString().split('T')[0];
    url = `${base}/api/interviewers/${ui.interviewerId}/schedule?day=${todayStr}`;
  }

  if (url) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        state = E.tick({ ...state, ...data });
        emit();
      } else {
        const error = await response.json().catch(() => ({}));
        toast(error.message || "Failed to load data from server", 'bad');
      }
    } catch (e) {
      console.error("Fetch error:", e);
      state = E.tick(state);
      emit();
    }
  }
}

// Dual-mode act: handles both legacy engine functions and direct endpoint strings safely
export async function act(actionOrEndpoint, methodOrArgs = 'POST', data = null, okMsg) {
  const base = getApiBase();

  // Mode 1: Legacy engine function passed (e.g. act(E.bookSlot, { slotId }))
  if (typeof actionOrEndpoint === 'function') {
    try {
      const r = actionOrEndpoint(state, methodOrArgs);
      state = E.tick(r.state);
      emit();
      const message = data || okMsg;
      if (message) toast(typeof message === 'function' ? message(r.result) : message);
      refreshState(); // Sync with backend in background
      return { ok: true, result: r.result };
    } catch (e) {
      if (e instanceof E.RuleError) {
        toast(e.message, 'bad');
        return { ok: false, error: e };
      }
      throw e;
    }
  }

  // Mode 2: Direct backend endpoint string call
  const endpoint = actionOrEndpoint;
  const method = typeof methodOrArgs === 'string' ? methodOrArgs.toUpperCase() : 'POST';
  const payload = typeof methodOrArgs === 'object' && methodOrArgs !== null && !Array.isArray(methodOrArgs) ? methodOrArgs : data;
  const successMessage = typeof methodOrArgs === 'string' ? data : okMsg;

  try {
    const options = {
      method,
      headers: { 'content-type': 'application/json' },
    };
    if (payload) {
      options.body = JSON.stringify(payload);
    }
    const response = await fetch(`${base}/api/${endpoint}`, options);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      toast(error.message || "Action failed", 'bad');
      return { ok: false, error };
    }

    const result = await response.json();
    await refreshState();
    if (successMessage) toast(typeof successMessage === 'function' ? successMessage(result) : successMessage);
    return { ok: true, result };
  } catch (e) {
    toast(e.message || "An error occurred", 'bad');
    return { ok: false, error: e };
  }
}

export async function resetDemo() {
  const base = getApiBase();
  try {
    const response = await fetch(`${base}/api/demo/reset`, { method: 'POST' });
    if (response.ok) {
      await refreshState();
      toast('Demo data reset successfully');
    } else {
      toast("Failed to reset demo", 'bad');
    }
  } catch (e) {
    toast("Failed to reset demo on server", 'bad');
  }
}

// Initial fetch
refreshState();