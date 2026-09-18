// The one place that knows where the agent is and how to talk to it: JSON calls and JSON-lines streams.
export const AGENT = 'http://127.0.0.1:7790';

const DOWN = 'The agent is not running. Start it with docker compose up -d agent, then try again.';
const reach = p => p.catch(e => { throw e instanceof TypeError ? new Error(DOWN) : e; });

export async function agentJson(path, body) {
  const r = await reach(fetch(`${AGENT}${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

/** POSTs, then hands every JSON line to onLine as it arrives; resolves when the stream ends. */
export async function agentStream(path, body, onLine, signal) {
  const r = await reach(fetch(`${AGENT}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }));
  if (!r.ok) { const data = await r.json().catch(() => ({})); throw new Error(data.error || r.statusText); }
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  const take = text => { try { onLine(JSON.parse(text)); } catch { /* not a JSON line */ } };
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl; while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (line) take(line); }
  }
  if (buf.trim()) take(buf.trim());
}
