const priority = new Map(['developing', 'blocked', 'planned', 'verified', 'integrated', 'released', 'archived'].map((key, index) => [key, index]));

export function parseFeatureView(raw) {
  let value;
  try { value = typeof raw === 'string' && raw.length <= 4096 ? JSON.parse(raw) : null; } catch { /* Corrupt browser preferences do not block records. */ }
  return { mode: value?.mode === 'time' ? 'time' : 'status', time: value?.time === 'created_at' ? 'created_at' : 'updated_at' };
}
export function featureTime(feature, field) {
  const value = field === 'created_at' ? feature.created_at : feature.updated_at || feature.created_at;
  const time = typeof value === 'string' && value.length <= 128 ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
}
export function groupFeatures(features, { mode, time, query = '', status = '', now = new Date() }) {
  const field = mode === 'time' ? time : 'updated_at', filter = query.trim().toLowerCase();
  const rows = features.filter(feature => (!status || feature.status === status)
    && `${feature.title} ${feature.owner ?? ''} ${feature.id}`.toLowerCase().includes(filter))
    .map(feature => ({ feature, time: featureTime(feature, field) }))
    .sort((a, b) => (b.time ?? -Infinity) - (a.time ?? -Infinity) || a.feature.id.localeCompare(b.feature.id));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const monday = new Date(today); monday.setDate(today.getDate() - (today.getDay() + 6) % 7);
  const bucket = time => time === null ? 'unknown' : time >= tomorrow.getTime() ? 'future'
    : time >= today.getTime() ? 'today' : time >= monday.getTime() ? 'week' : 'earlier';
  const groups = new Map();
  for (const row of rows) {
    const key = mode === 'time' ? bucket(row.time) : typeof row.feature.status === 'string' ? row.feature.status : '';
    if (!groups.has(key)) groups.set(key, { key, items: [] });
    groups.get(key).items.push(row.feature);
  }
  const order = mode === 'time' ? new Map(['future', 'today', 'week', 'earlier', 'unknown'].map((key, index) => [key, index])) : priority;
  return [...groups.values()].sort((a, b) => (order.get(a.key) ?? 100) - (order.get(b.key) ?? 100) || a.key.localeCompare(b.key));
}
