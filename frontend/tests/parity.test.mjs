import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
import * as M from '../src/domain/messages.js'; import { TRANSITIONS } from '../src/domain/states.js'; import { suggestSlots } from '../src/domain/suggest.js';
const P = JSON.parse(readFileSync(new URL('../../docs/parity.json', import.meta.url)));
const arg = (v) => (v && typeof v === 'object' ? v.ms : v);
test('every message matches the Python backend, character for character', () => {
  for (const c of P.messages) assert.deepEqual(M[c.fn](...c.args.map(arg)), c.out, c.fn);
});
test('state transition table matches the backend', () => {
  assert.deepEqual(Object.entries(TRANSITIONS).map(([k, v]) => `${k}|${v}`).sort(), P.transitions);
});
test('slot suggestions match the backend ranking', () => {
  const { now, slots, load, out } = P.suggest;
  const js = suggestSlots(slots.map((s) => ({ id: s.id, interviewerId: s.interviewer_id, startsAt: s.starts_at })), now, load, 3);
  assert.deepEqual(js.map((r) => ({ slot_id: r.slotId, score: r.score, reasons: r.reasons })), out);
});
