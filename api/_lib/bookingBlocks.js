// Shared fixed reservation blocks. Customer performance times remain separate.
export const BOOKING_ZONE = 'America/Los_Angeles';
export function localDate(value) {
  if (typeof value !== 'string') throw new Error('Missing event date.');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new Error('Datetime must include a timezone offset.');
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) throw new Error('Invalid datetime.');
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: BOOKING_ZONE, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(d).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function utc(date, hour) {
  const target = Date.parse(`${date}T${hour}:00:00Z`);
  let candidate = target;
  for (let i=0;i<4;i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: BOOKING_ZONE, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(new Date(candidate)).map(x=>[x.type,x.value]));
    const displayed = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const delta = target - displayed;
    if (!delta) return new Date(candidate).toISOString();
    candidate += delta;
  }
  throw new Error('Cannot resolve reservation timezone.');
}
export function blockWindow(date, block) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date) throw new Error('Invalid event date.');
  if (!['day','night'].includes(block)) throw new Error('Invalid reservation block.');
  const next = new Date(Date.parse(`${date}T00:00:00Z`)+86400000).toISOString().slice(0,10);
  return {start:utc(date,block==='day'?'06':'18'), end:utc(block==='day'?date:next,block==='day'?'16':'03')};
}
export function hasBlockSlot(raw, window) {
  const data = raw?.data || raw;
  const arrays = Array.isArray(data) ? [data] : Object.values(data || {}).filter(Array.isArray);
  return arrays.flat().some(r=>Date.parse(r?.start)===Date.parse(window.start) && Date.parse(r?.end)>=Date.parse(window.end));
}
export function eventNameFor(block) {
  return block==='day' ? (process.env.CAL_EVENT_TYPE_NAME_DAY || 'Day time DJ') : (process.env.CAL_EVENT_TYPE_NAME || 'Night gig');
}
