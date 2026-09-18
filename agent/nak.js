// The one way this process runs nak: arguments only, never a shell, stdin closed unless input is given.
import { spawn } from 'node:child_process';

/** Resolves to { out, err, code }. A non-zero exit is not an exception: callers decide what failure means. */
export function nak(args, { input = '' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('nak', args, { env: { ...process.env, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => resolve({ out: out.trim(), err: err.trim(), code }));
    child.stdin.end(input);
  });
}
/** The common case: stdout of a command that must succeed; the last stderr line is the error. */
export async function nakOut(args, opts) {
  const r = await nak(args, opts);
  if (r.code !== 0) throw new Error((r.err || r.out || `nak exited with ${r.code}`).split('\n').pop());
  return r.out;
}
export const safeJson = text => { try { return JSON.parse(text); } catch { return undefined; } };
/** An event object, or null: nak prints one JSON event per line on stdout. */
export const parseEvent = text => { const e = safeJson(text); return e && typeof e === 'object' && !Array.isArray(e) && Number.isInteger(e.kind) ? e : null; };
export const eventLines = out => out.split('\n').map(l => parseEvent(l.trim())).filter(Boolean);
