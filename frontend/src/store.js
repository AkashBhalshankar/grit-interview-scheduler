import { useSyncExternalStore } from 'react';

const KEY = 'grit.ui';
const safe = (f) => { try { return f(); } catch { return null; } };

const getApiBase = () => {
  if (typeof window !== 'undefined' && window.VITE_API_URL) {
    return window.VITE_API_URL;
  }
  return import.meta.env.VITE_API_URL || "http://localhost:8000";
};

let ui = {
  role: 'student',
  studentId: 'stu_aarav',
  interviewerId: 'iv_priya',
  ...(safe(() => JSON.parse(localStorage.getItem(KEY + '.ui'))) || {}),
  toast: null
};

let state = null; // Remote data fetched from FastAPI backend
let snap = { state, ui };
const subs = new Set();

const emit = () => {
  snap = { state, ui };
  safe(() => {
    localStorage.setItem(KEY + '.ui', JSON.stringify(ui));
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
        state = await response.json();
        emit();
      } else {
        const error = await response.json().catch(() => ({}));
        toast(error.message || "Failed to load data from server", 'bad');
      }
    } catch (e) {
      toast("Network error connecting to backend", 'bad');
    }
  }
}

export async function act(endpoint, method = 'POST', data = null, okMsg) {
  const base = getApiBase();
  try {
    const options = {
      method,
      headers: { 'content-type': 'application/json' },
    };
    if (data) {
      options.body = JSON.stringify(data);
    }
    const response = await fetch(`${base}/api/${endpoint}`, options);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      toast(error.message || "Action failed", 'bad');
      return { ok: false, error };
    }

    const result = await response.json();
    await refreshState();
    if (okMsg) toast(typeof okMsg === 'function' ? okMsg(result) : okMsg);
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

// Trigger initial data load when store initializes
refreshState();