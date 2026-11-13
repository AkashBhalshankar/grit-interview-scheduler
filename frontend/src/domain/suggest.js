// Mirror of backend/app/ai.py scoring: deterministic, explainable, cannot invent a slot.
import { istParts } from './time.js';

export function scoreSlot(startsAt, now, load) {
  const hours = (startsAt - now) / 3_600_000;
  let score = 0; const reasons = [];
  score += Math.max(0, 40 - (hours / 24) * 8);
  const h = istParts(startsAt).h;
  if (h >= 10 && h < 18) { score += 20; reasons.push('Daytime slot (10 AM to 6 PM)'); }
  else if (h === 9 || h === 18) score += 10;
  score += Math.max(0, 15 - 3 * load);
  if (load <= 2) reasons.push('Interviewer has a light schedule');
  return [score, reasons];
}

export function suggestSlots(slots, now, loadByInterviewer, k = 3) {
  if (!slots.length) return [];
  const earliest = Math.min(...slots.map((s) => s.startsAt));
  const ranked = slots.map((s) => {
    const [sc, rs] = scoreSlot(s.startsAt, now, loadByInterviewer[s.interviewerId] ?? 0);
    const reasons = s.startsAt === earliest ? ['Earliest available', ...rs] : rs;
    return { slotId: s.id, score: Math.round(sc * 100) / 100, reasons: reasons.length ? reasons : ['Open slot'], t: s.startsAt, iv: s.interviewerId };
  });
  ranked.sort((a, b) => b.score - a.score || a.t - b.t);
  const out = [], seen = new Set(), strip = ({ t, iv, ...r }) => r;
  for (const r of ranked) { if (seen.has(r.iv)) continue; seen.add(r.iv); out.push(strip(r)); if (out.length === k) return out; }
  for (const r of ranked) { if (out.length === k) break; if (!out.some((o) => o.slotId === r.slotId)) out.push(strip(r)); }
  return out;
}
