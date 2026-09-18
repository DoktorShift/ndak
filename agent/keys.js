// Shared by agent.js and seed.js: the identities file format, and how relay URLs are dialled from inside a container.
import { existsSync, readFileSync } from 'node:fs';

/** name -> secret, from a `name=secret` file (hex or nsec). Only names are ever reported to the browser. */
export function parseEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?([^"'#\s]+)["']?/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Inside a container "localhost" is the container itself. A map such as "7777=rnostr:8080,7779=nostr-rs-relay:8080" sends
 *  the stack's own ports to their services; any other localhost port goes to `host` (host.docker.internal) when one is set.
 *  Output is mapped back, so what people read matches what they typed. Only whole-URL arguments are rewritten. */
export function dialer(mapText = '', host = '') {
  const map = new Map((mapText || '').split(',').map(s => s.trim()).filter(Boolean).map(s => s.split('=')));   // port -> service:port
  const back = [...map].map(([port, target]) => [target, `localhost:${port}`]);
  const toDial = a => a.replace(/^(wss?|https?):\/\/(?:localhost|127\.0\.0\.1)(?::(\d+))?(?=\/|$)/i, (m, scheme, port) =>
    map.has(port) ? `${scheme}://${map.get(port)}` : host ? `${scheme}://${host}${port ? `:${port}` : ''}` : m);
  const fromDial = text => { let out = text; for (const [target, local] of back) out = out.split(target).join(local); return host ? out.split(host).join('localhost') : out; };
  return { toDial, fromDial };
}
