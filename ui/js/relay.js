// Relay connections: several at once, one firehose subscription each. Every event remembers where it was seen.
// Emits: relay:state {url,state,text} · relay:event {ev,url} · relay:eose {url} · relay:info {url,info} · relay:message {url,dir,msg} · relay:error {url,reason}
import { emit } from './bus.js';
import { settings, saveSettings, store, relayByUrl } from './state.js';
import { safeJson } from './format.js';

const SUB = 'window';
const connections = new Map();   // url -> { socket, state, text, live }

export const stateOf = url => connections.get(url)?.state || 'off';
export const isConnected = url => connections.get(url)?.socket?.readyState === 1;
export const isLive = url => !!connections.get(url)?.live;
export const anyLive = () => [...connections.values()].some(c => c.live);
export const connectedUrls = () => [...connections.keys()].filter(isConnected);
const setState = (url, state, text) => { const c = connections.get(url); if (c) { c.state = state; c.text = text; } emit('relay:state', { url, state, text }); };
const log = (url, dir, msg) => { const list = store.log.get(url) || []; list.push({ t: Date.now(), dir, msg }); if (list.length > 300) list.shift(); store.log.set(url, list); emit('relay:message', { url, dir, msg }); };

export function connect(url) {
  if (isConnected(url)) return;
  disconnect(url);
  let socket;
  try { socket = new WebSocket(url); } catch { emit('relay:error', { url, reason: 'invalid' }); return; }
  connections.set(url, { socket, state: 'connecting', text: 'connecting', live: false });
  setState(url, 'connecting', 'connecting');
  socket.onopen = () => {
    setState(url, 'loading', 'loading stored events');
    const req = ['REQ', SUB, { limit: settings.limit }]; socket.send(JSON.stringify(req)); log(url, 'out', req);
    fetchInfo(url);
  };
  socket.onmessage = m => {
    const msg = safeJson(m.data); if (!Array.isArray(msg)) return;
    if (msg[0] === 'EVENT' && msg[1] === SUB) { emit('relay:event', { ev: msg[2], url }); return; }
    log(url, 'in', msg);
    if (msg[0] === 'EOSE') { const c = connections.get(url); if (c) c.live = true; setState(url, 'live', 'live'); emit('relay:eose', { url }); }
    else if (msg[0] === 'NOTICE') setState(url, stateOf(url), `notice: ${msg[1]}`);
    else if (msg[0] === 'CLOSED') setState(url, 'closed', `subscription closed: ${msg[2] || ''}`);
    else if (msg[0] === 'AUTH') setState(url, stateOf(url), 'relay asks for AUTH (NIP-42)');
  };
  socket.onclose = () => { if (connections.get(url)?.socket === socket) { connections.delete(url); setState(url, 'off', 'disconnected'); } };
  socket.onerror = () => { setState(url, 'error', `cannot reach ${url}`); emit('relay:error', { url, reason: 'unreachable' }); };
}

export function disconnect(url) {
  const c = connections.get(url); if (!c) return;
  connections.delete(url); c.socket.onclose = null; c.socket.close();
  setState(url, 'off', 'disconnected');
}
export function setActive(url, on) {
  const active = new Set(settings.active); on ? active.add(url) : active.delete(url);
  settings.active = [...active]; saveSettings();
  on ? connect(url) : disconnect(url);
}
export function connectAll() { for (const r of settings.relays) setActive(r.url, true); }
export function disconnectAll() { for (const url of [...connections.keys()]) setActive(url, false); }
export function connectActive() { for (const url of settings.active) connect(url); }

/** NIP-11 over http with the nostr+json accept header; the name feeds the relay list. */
async function fetchInfo(url) {
  try {
    const r = await fetch(url.replace(/^ws/, 'http'), { headers: { Accept: 'application/nostr+json' } });
    const info = await r.json(); store.relayInfo.set(url, info);
    const entry = relayByUrl(url); if (info.name && entry && entry.name !== info.name) { entry.name = info.name; saveSettings(); }
    emit('relay:info', { url, info });
  } catch { store.relayInfo.set(url, null); emit('relay:info', { url, info: null }); }
}

/** One-off query on a separate socket: REQ, collect until EOSE or timeout, close. Used by Query and Compare. */
export function queryOnce(url, filter, timeoutMs = 8000) {
  return new Promise(resolve => {
    const events = []; const messages = []; let done = false; let socket;
    const finish = (status) => { if (done) return; done = true; try { socket?.close(); } catch { /* closed */ } resolve({ url, status, events, messages, ms: Date.now() - t0 }); };
    const t0 = Date.now(); const timer = setTimeout(() => finish('timeout'), timeoutMs);
    try { socket = new WebSocket(url); } catch { clearTimeout(timer); return finish('invalid'); }
    socket.onopen = () => socket.send(JSON.stringify(['REQ', 'q', filter]));
    socket.onmessage = m => {
      const msg = safeJson(m.data); if (!Array.isArray(msg)) return;
      if (msg[0] === 'EVENT') events.push(msg[2]);
      else { messages.push(msg); if (msg[0] === 'EOSE' || msg[0] === 'CLOSED') { clearTimeout(timer); finish(msg[0] === 'EOSE' ? 'ok' : 'closed'); } }
    };
    socket.onerror = () => { clearTimeout(timer); finish('unreachable'); };
  });
}

/** COUNT on a separate socket (NIP-45); resolves the count or null when the relay does not answer. */
export function countOnce(url, filter, timeoutMs = 5000) {
  return new Promise(resolve => {
    let socket; const timer = setTimeout(() => { try { socket?.close(); } catch { /* closed */ } resolve(null); }, timeoutMs);
    try { socket = new WebSocket(url); } catch { clearTimeout(timer); return resolve(null); }
    socket.onopen = () => socket.send(JSON.stringify(['COUNT', 'c', filter]));
    socket.onmessage = m => { const msg = safeJson(m.data); if (Array.isArray(msg) && msg[0] === 'COUNT') { clearTimeout(timer); socket.close(); resolve(msg[2]?.count ?? null); } else if (Array.isArray(msg) && (msg[0] === 'NOTICE' || msg[0] === 'CLOSED')) { clearTimeout(timer); socket.close(); resolve(null); } };
    socket.onerror = () => { clearTimeout(timer); resolve(null); };
  });
}

// ---------- relay list ----------
export function addRelay(url) {
  const clean = url.trim().replace(/\/$/, '');
  if (!/^wss?:\/\/\S+$/.test(clean)) return false;
  if (!settings.relays.some(r => r.url === clean)) { settings.relays.push({ url: clean, name: '' }); saveSettings(); }
  return clean;
}
export function removeRelay(url) {
  if (settings.relays.length < 2) return false;
  disconnect(url);
  settings.relays = settings.relays.filter(r => r.url !== url); settings.active = settings.active.filter(u => u !== url); saveSettings();
  return true;
}
