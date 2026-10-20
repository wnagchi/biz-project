import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFeatures, parseFeatureView } from '../web/src/feature-list.mjs';

const row = (id, status, updated_at, created_at = updated_at) => ({ id, project_id: 'one', title: id, owner: 'codex', status, updated_at, created_at });
const ids = group => group.items.map(item => item.id);

test('status groups prioritize active work, count filtered rows, keep unknown values and never mutate input', () => {
  const features = [row('old', 'released', '2026-10-12'), row('z', 'planned', '2026-10-13'),
    row('new', 'developing', '2026-10-14'), row('block', 'blocked', '2026-10-13'),
    row('other', '__proto__', ''), row('legacy', 'constructor', ''), row('a', 'planned', '2026-10-13')];
  const before = structuredClone(features);
  const groups = groupFeatures(features, { mode: 'status', time: 'updated_at' });
  assert.deepEqual(groups.map(group => group.key), ['developing', 'blocked', 'planned', 'released', '__proto__', 'constructor']);
  assert.deepEqual(ids(groups[2]), ['a', 'z']);
  assert.deepEqual(features, before);
  assert.deepEqual(ids(groupFeatures(features, { mode: 'status', time: 'updated_at', status: 'planned', query: 'Z' })[0]), ['z']);
  assert.equal(groupFeatures(features, { mode: 'status', time: 'updated_at', query: 'not found' }).length, 0);
});

test('time groups use local calendar days and Monday weeks, with future/invalid dates separated', () => {
  const now = new Date(2026, 9, 21, 12), stamp = day => new Date(2026, 9, day, 9).toISOString();
  const groups = groupFeatures([row('mon', 'planned', stamp(19)), row('today', 'developing', stamp(21)),
    row('sun', 'released', stamp(18)), row('future', 'planned', stamp(22)), row('invalid', 'planned', 'invalid')],
    { mode: 'time', time: 'updated_at', now });
  assert.deepEqual(groups.map(group => group.key), ['future', 'today', 'week', 'earlier', 'unknown']);
  assert.deepEqual(groups.map(ids), [['future'], ['today'], ['mon'], ['sun'], ['invalid']]);
  const monday = groupFeatures([row('sun', 'planned', stamp(18)), row('mon', 'planned', stamp(19))],
    { mode: 'time', time: 'updated_at', now: new Date(2026, 9, 19, 12) });
  assert.deepEqual(monday.map(group => group.key), ['today', 'earlier']);
});

test('creation-time view uses actual creation fields; missing creation stays unknown', () => {
  const now = new Date(2027, 0, 1, 12), stamp = new Date(2027, 0, 1, 8).toISOString();
  const groups = groupFeatures([row('recent', 'planned', stamp, '2026-12-20T08:00:00Z'),
    row('created', 'planned', '2026-12-20T08:00:00Z', stamp), { ...row('missing', 'planned', stamp), created_at: undefined }],
    { mode: 'time', time: 'created_at', now });
  assert.deepEqual(groups.map(ids), [['created'], ['recent'], ['missing']]);
  assert.deepEqual(groups.map(group => group.key), ['today', 'earlier', 'unknown']);
});

test('view preferences validate local storage data and tolerate missing/corrupt/oversized values', () => {
  const defaults = { mode: 'status', time: 'updated_at' };
  for (const raw of [null, '', 'broken', '[]', 'null', '"time"', ' '.repeat(5000)]) assert.deepEqual(parseFeatureView(raw), defaults);
  assert.deepEqual(parseFeatureView('{"mode":"time","time":"created_at"}'), { mode: 'time', time: 'created_at' });
  assert.deepEqual(parseFeatureView('{"mode":"__proto__","time":"constructor"}'), defaults);
});

test('a full 2000-feature summary remains in-memory and preserves all rows', t => {
  const features = Array.from({ length: 2000 }, (_, i) => row(`task-${String(i).padStart(4, '0')}`, i % 2 ? 'developing' : 'planned', new Date(2026, 9, 19, 0, i).toISOString()));
  const before = performance.now(), groups = groupFeatures(features, { mode: 'status', time: 'updated_at' });
  t.diagnostic(`2000 features grouped/sorted: ${(performance.now() - before).toFixed(1)} ms`);
  assert.equal(groups.reduce((total, group) => total + group.items.length, 0), 2000);
  assert.equal(groups[0].items[0].id, 'task-1999');
});
