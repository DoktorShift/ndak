// The agent's own page at http://127.0.0.1:7790/: what this process is, what it holds and what it never does.
// Inline styles, system font, light and dark, no scripts: a note on the door, not an app.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function pageHtml({ nak, identities, relayMap, relayHost, origins, scenarios, uiUrl, since }) {
  const held = identities.length ? identities.map(n => `<code>$${esc(n)}</code>`).join(' ') : '<span class="muted">none yet: mint one in the window or run the seed</span>';
  const dial = relayMap ? `the stack's relays by service name; any other localhost port through ${esc(relayHost || 'localhost')}` : 'localhost directly';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Relay Window Agent</title><link rel="icon" href="data:,">
<style>
  :root { --bg: #F5F5F7; --card: #FFFFFF; --label: #1D1D1F; --label2: rgba(60,60,67,.72); --sep: rgba(60,60,67,.18); --blue: #007AFF; --green: #1E7B37; --fill: rgba(120,120,128,.12); }
  @media (prefers-color-scheme: dark) { :root { --bg: #121214; --card: #1C1C1E; --label: #FFFFFF; --label2: rgba(235,235,245,.64); --sep: rgba(84,84,88,.65); --blue: #0A84FF; --green: #30D158; --fill: rgba(120,120,128,.24); } }
  * { box-sizing: border-box; } body { margin: 0; background: var(--bg); color: var(--label); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  main { max-width: 620px; margin: 0 auto; padding: 56px 20px 64px; } h1 { font-size: 26px; letter-spacing: -.01em; margin: 0 0 6px; } .lead { color: var(--label2); margin: 0 0 28px; font-size: 16px; }
  section { background: var(--card); border-radius: 14px; padding: 16px 18px; margin: 0 0 14px; box-shadow: 0 1px 2px rgba(0,0,0,.06); } h2 { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--label2); margin: 0 0 10px; }
  ul { margin: 0; padding: 0 0 0 18px; } li { margin: 4px 0; } .row { display: flex; justify-content: space-between; gap: 16px; padding: 7px 0; border-top: 1px solid var(--sep); } .row:first-of-type { border-top: 0; } .row span:last-child { text-align: right; color: var(--label2); }
  code { font: 13px ui-monospace, "SF Mono", Menlo, monospace; background: var(--fill); padding: 1px 6px; border-radius: 5px; } .muted { color: var(--label2); } .ok { color: var(--green); font-weight: 600; }
  a.button { display: inline-block; background: var(--blue); color: #fff; text-decoration: none; font-weight: 600; padding: 9px 16px; border-radius: 10px; margin-top: 4px; } a { color: var(--blue); }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; } td { padding: 6px 0; border-top: 1px solid var(--sep); vertical-align: top; } td:first-child { white-space: nowrap; padding-right: 14px; } tr:first-child td { border-top: 0; }
</style></head><body><main>
<h1>Relay Window Agent</h1>
<p class="lead">The small helper behind the terminal in Relay Window. It runs <a href="https://github.com/fiatjaf/nak" target="_blank" rel="noopener"><code>nak</code></a>, the Nostr army knife by fiatjaf, on this machine for the page and keeps the identity keys where the page cannot see them.</p>
<section><h2>Status</h2>
  <div class="row"><span>Running since</span><span class="ok">${esc(since)}</span></div>
  <div class="row"><span>nak</span><span class="ok">${esc((nak || 'not found').replace(/^nak version /, ''))}</span></div>
  <div class="row"><span>Identities held</span><span>${held}</span></div>
  <div class="row"><span>Reaches relays</span><span>${dial}</span></div>
  <div class="row"><span>Accepts requests from</span><span>${origins.map(esc).join('<br>')}</span></div>
  <div class="row"><span>Scenarios available</span><span>${scenarios}</span></div>
</section>
<section><h2>What it does</h2><ul>
  <li>Runs the commands typed into the window's terminal and streams the output back.</li>
  <li>Signs for named identities: <code>$creator</code> in a command becomes the real key here, never in the page.</li>
  <li>Mints identities, opens sealed messages with a held key, and runs relay test scenarios.</li>
</ul></section>
<section><h2>What it never does</h2><ul>
  <li>It never runs anything but <code>nak</code> and <code>jq</code>: no shell, no other programs.</li>
  <li>It never answers anyone but the window: only requests from the page's own origin, on this machine only.</li>
  <li>It never sends a secret key anywhere: keys stay in <code>identities/</code> next to the compose file.</li>
</ul></section>
<section><h2>Endpoints</h2><table>
  <tr><td><code>GET /health</code></td><td>nak version, identity names, how relays are dialled</td></tr>
  <tr><td><code>GET /identities</code></td><td>names and public keys of the held identities</td></tr>
  <tr><td><code>POST /identities</code></td><td>mint a key, publish its profile and relay list</td></tr>
  <tr><td><code>POST /identities/remove</code></td><td>forget a key</td></tr>
  <tr><td><code>POST /run</code></td><td>run a nak or jq command line; output streams as JSON lines</td></tr>
  <tr><td><code>POST /decrypt</code></td><td>open a sealed event with a held key; returns its layers</td></tr>
  <tr><td><code>GET /scenarios</code></td><td>the scenario files in <code>scenarios/</code></td></tr>
  <tr><td><code>POST /scenarios/run</code></td><td>run one; each check streams as a JSON line</td></tr>
</table></section>
<p><a class="button" href="${esc(uiUrl)}">Open Relay Window</a></p>
</main></body></html>`;
}
