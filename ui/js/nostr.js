// Nostr primitives: kind classes, tag access and NIP-19 codes. No DOM access here.

export const isEphemeral = kind => kind >= 20000 && kind < 30000;
export const isReplaceable = kind => kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
export const isAddressable = kind => kind >= 30000 && kind < 40000;
export const isHex32 = s => /^[0-9a-f]{64}$/.test(s || '');

export const tagRow = (ev, name) => ev.tags.find(t => t[0] === name);
export const tag = (ev, name) => tagRow(ev, name)?.[1];
export const tags = (ev, name) => ev.tags.filter(t => t[0] === name);
export const address = ev => `${ev.kind}:${ev.pubkey}:${tag(ev, 'd') ?? ''}`;

/** NIP-10: the event a note replies to. Marked "reply" wins, then "root", then the last e tag. */
export function replyTo(ev) {
  const es = tags(ev, 'e');
  if (!es.length) return undefined;
  const marked = es.find(t => t[3] === 'reply') || es.find(t => t[3] === 'root');
  return (marked || es[es.length - 1])[1];
}

/** Reactions, reposts and zap receipts point at their target with their last e tag. */
export const targetOf = ev => tags(ev, 'e').at(-1)?.[1];

// ---------- bech32 / NIP-19 ----------
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GENERATORS[i];
  }
  return chk >>> 0;
}
const hrpExpand = hrp => [...hrp].map(c => c.charCodeAt(0) >> 5).concat([0], [...hrp].map(c => c.charCodeAt(0) & 31));

function convertBits(data, from, to, pad) {
  const out = []; let acc = 0, bits = 0; const max = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value; bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & max); }
  }
  if (pad && bits) out.push((acc << (to - bits)) & max);
  return out;
}
const hexToBytes = hex => (hex.match(/../g) || []).map(h => parseInt(h, 16));
const bytesToHex = bytes => bytes.map(b => b.toString(16).padStart(2, '0')).join('');
const utf8 = s => [...new TextEncoder().encode(s)];

function bech32Encode(hrp, bytes) {
  const words = convertBits(bytes, 8, 5, true);
  const mod = polymod(hrpExpand(hrp).concat(words, [0, 0, 0, 0, 0, 0])) ^ 1;
  const checksum = []; for (let i = 0; i < 6; i++) checksum.push((mod >> (5 * (5 - i))) & 31);
  return hrp + '1' + words.concat(checksum).map(w => CHARSET[w]).join('');
}

function bech32Decode(str) {
  const s = String(str || '').toLowerCase(); const sep = s.lastIndexOf('1');
  if (sep < 1) return null;
  const hrp = s.slice(0, sep); const words = [...s.slice(sep + 1)].map(c => CHARSET.indexOf(c));
  if (words.includes(-1) || polymod(hrpExpand(hrp).concat(words)) !== 1) return null;
  return { hrp, bytes: convertBits(words.slice(0, -6), 5, 8, false) };
}

const tlv = entries => entries.flatMap(([type, bytes]) => [type, bytes.length, ...bytes]);
const u32 = n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];

export const npubEncode = hex => bech32Encode('npub', hexToBytes(hex));
export function neventEncode(id, { relay, author } = {}) {
  return bech32Encode('nevent', tlv([[0, hexToBytes(id)], ...(relay ? [[1, utf8(relay)]] : []), ...(author ? [[2, hexToBytes(author)]] : [])]));
}

/** Decode any NIP-19 code to { hrp, hex } where hex is the pubkey, event id or d-tag it points at. */
export function decodeCode(code) {
  const d = bech32Decode(code); if (!d) return null;
  if (d.hrp === 'npub' || d.hrp === 'note') return { hrp: d.hrp, hex: bytesToHex(d.bytes) };
  if (d.hrp === 'nprofile' || d.hrp === 'nevent' || d.hrp === 'naddr') {
    let i = 0;
    while (i + 1 < d.bytes.length) {
      const type = d.bytes[i], len = d.bytes[i + 1], value = d.bytes.slice(i + 2, i + 2 + len);
      if (type === 0) return { hrp: d.hrp, hex: d.hrp === 'naddr' ? new TextDecoder().decode(new Uint8Array(value)) : bytesToHex(value) };
      i += 2 + len;
    }
  }
  return null;
}
