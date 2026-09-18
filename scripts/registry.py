#!/usr/bin/env python3
"""Regenerate js/registry.js from the official NIP index. Usage: python3 scripts/registry.py"""
import re, json, pathlib, urllib.request
md = urllib.request.urlopen('https://raw.githubusercontent.com/nostr-protocol/nips/master/README.md', timeout=30).read().decode()
# Deprecated NIPs are struck through in the index ("- ~~[NIP-04: ...](04.md) --- **unrecommended**: ...~~"); keep them, with the note.
nips = {}
for m in re.finditer(r'^- (~~)?\[NIP-([0-9A-Za-z]+): (.+?)\]\(([^)]+)\)(.*)$', md, re.M):
    struck, num, title, file, rest = m.groups()
    note = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', rest).replace('~~', '').replace('**', '').strip(' -:')
    nips[num] = {'title': title, 'file': file, **({'deprecated': note or 'deprecated'} if struck else {})}
kinds = []
for line in md[md.index('## Event Kinds'):md.index('## Message types')].splitlines():
    m = re.match(r'^\| *`(\d+)`(?:-`(\d+)`)? *\| *(.+?) *\| *(.*?) *\|$', line)
    if m:
        lo, hi, name, nipcol = m.groups()
        kinds.append({'from': int(lo), 'to': int(hi) if hi else int(lo), 'name': name.replace('`', '').strip(), 'nips': re.findall(r'\[([0-9A-Za-z]+)\]\(', nipcol)})
out = "// Generated from https://github.com/nostr-protocol/nips/blob/master/README.md by scripts/registry.py. Do not edit by hand.\n"
out += "export const NIPS = " + json.dumps(nips, ensure_ascii=False, separators=(',', ':')) + ";\n"
out += "export const KIND_RANGES = " + json.dumps(kinds, ensure_ascii=False, separators=(',', ':')) + ";\n"
pathlib.Path(__file__).resolve().parent.parent.joinpath('ui/js/registry.js').write_text(out)
print(f'{len(nips)} NIPs, {len(kinds)} kind rows')
