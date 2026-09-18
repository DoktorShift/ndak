// Formatting helpers: escaping, time, money, light markdown. No app state here.

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const stripHtml = s => String(s).replace(/<[^>]+>/g, '');
export const shortHex = h => (h ? h.slice(0, 8) + '…' : '?');
export const safeJson = s => { try { return JSON.parse(s); } catch { return null; } };
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const isImageUrl = u => /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(u);
/** Quote a string for a POSIX shell. */
export const shellQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

const now = () => Math.floor(Date.now() / 1000);
export const fmtTime = ts => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const fmtDate = ts => new Date(ts * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
export function ago(ts) {
  const s = now() - ts;
  if (s < 0) return 'from the future'; if (s < 60) return 'now'; if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`; return `${Math.floor(s / 86400)}d`;
}
export function untilText(ts) {
  const s = ts - now();
  if (s <= 0) return 'expired'; if (s < 3600) return `expires in ${Math.ceil(s / 60)} min`;
  if (s < 86400) return `expires in ${Math.ceil(s / 3600)} h`; return `expires in ${Math.ceil(s / 86400)} d`;
}
export function dayLabel(ts) {
  const d = new Date(ts * 1000), t = new Date(); const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, t)) return 'Today';
  const y = new Date(t); y.setDate(t.getDate() - 1); if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Amount in sats from a bolt11 invoice prefix (lnbc21u1… → 2,100). Only the human-readable part is parsed. */
export function bolt11Sats(invoice) {
  const m = /^ln(?:bc|tb|bcrt)(\d+)([munp]?)1/i.exec(invoice || ''); if (!m) return 0;
  const mult = { '': 1e8, m: 1e5, u: 1e2, n: 0.1, p: 0.0001 }[m[2].toLowerCase()];
  return Math.round(Number(m[1]) * mult);
}
/** NIP-88 amount tag: ["amount", value, "msats"|"sats", period] → "21,000 sats monthly". */
export function amountText(ev) {
  const a = ev.tags.find(t => t[0] === 'amount'); if (!a) return '';
  const n = Number(a[1]); const sats = (a[2] || '').toLowerCase().startsWith('msat') ? n / 1000 : n;
  return `${sats.toLocaleString()} sats ${a[3] || ''}`.trim();
}

/** Minimal markdown for long-form content: headings, paragraphs, quotes, bold, italic, links. */
export function mdLite(text) {
  return esc(text).split(/\n{2,}/).map(block => {
    if (/^#{1,3}\s/.test(block)) return `<h3>${block.replace(/^#{1,3}\s/, '')}</h3>`;
    if (/^>\s?/.test(block)) return `<blockquote>${block.replace(/^>\s?/gm, '')}</blockquote>`;
    const inline = block.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/\[(.+?)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
    return `<p>${inline}</p>`;
  }).join('');
}
