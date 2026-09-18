// Guided tours: a dimmed veil with a spotlight on one control and a callout beside it. Steps are plain objects
// (see tours.js). The engine only knows how to point, place, and move; the app decides what a step prepares.
import { settings, saveSettings } from './state.js';
import { esc } from './format.js';

const $ = id => document.getElementById(id);
let current = null;   // { tour, index }
const listeners = [];

/** tour: { id, title, dismiss?, onDone?, steps: [{ target?, title, text, tip?, action?, placement?, wait?, cta? }] }; dismiss labels a decline button on a one-step tour. */
export async function start(tour, index = 0) {
  stop(false);
  current = { tour, index: -1 };
  showOverlay(true);
  document.body.classList.add('touring');
  await go(index);
  window.addEventListener('resize', reposition); window.addEventListener('keydown', onKey, true);
}
export function stop(markSeen = true) {
  if (!current) return;
  if (markSeen) remember(current.tour.id);
  current = null; showOverlay(false); document.body.classList.remove('touring');
  window.removeEventListener('resize', reposition); window.removeEventListener('keydown', onKey, true);
  for (const off of listeners.splice(0)) off();
}
export const active = () => current;
export function next() { if (!current) return; if (current.index + 1 < current.tour.steps.length) go(current.index + 1); else { const done = current.tour.onDone; stop(true); done?.(); } }
export function back() { if (current && current.index > 0) go(current.index - 1); }
function remember(id) { settings.tours = settings.tours || {}; settings.tours[id] = Date.now(); saveSettings(); }
export const seen = id => !!(settings.tours || {})[id];

async function go(index) {
  const step = current.tour.steps[index]; current.index = index;
  if (step.action) { try { await step.action(); } catch { /* a step may fail to prepare; it still shows */ } }
  await settle(step.wait || 60);
  if (current) showOverlay(true);   // a sheet the step opened or closed changes where the overlay must live
  render();
}
const settle = ms => new Promise(r => setTimeout(r, ms));
/** Sheets are modal dialogs and paint in the browser's top layer, above everything else. While one is open the overlay
 *  lives inside it, so the veil and the callout can point at controls in the sheet; otherwise it lives in the body. */
function showOverlay(on) {
  const el = $('tour'); const sheet = $('sheet'); const host = sheet?.open ? sheet : document.body;
  if (on && el.parentElement !== host) host.appendChild(el);
  el.hidden = !on;
}

function render() {
  if (!current) return;
  const { tour, index } = current; const step = tour.steps[index]; const total = tour.steps.length;
  const target = step.target ? findTarget(step.target) : null;
  const card = $('tourCard');
  card.innerHTML = `
    <div class="tk"><span>${esc(tour.title)}</span><span>${esc(step.label || '')}</span></div>
    <h3>${esc(step.title)}</h3>
    <p>${step.text}</p>
    ${step.tip ? `<p class="tt">${step.tip}</p>` : ''}
    <div class="tn">
      ${index + 1 < total ? '<button class="tb-plain" data-tour-act="skip">Skip Tour</button>' : ''}${index > 0 ? '<button class="tb-plain" data-tour-act="back">Back</button>' : tour.dismiss && total === 1 ? `<button class="tb-plain" data-tour-act="skip">${esc(tour.dismiss)}</button>` : ''}
      <button class="tb-go" data-tour-act="next">${index + 1 < total ? (step.cta || 'Next') : (step.cta || 'Done')}</button>
      ${total > 1 ? `<span class="td" aria-hidden="true">${tour.steps.map((_, i) => `<i class="${i === index ? 'on' : ''}"></i>`).join('')}</span>` : ''}
    </div>`;
  card.querySelector('[data-tour-act="next"]').focus({ preventScroll: true });
  place(target, step.placement);
  if (target) { target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); requestAnimationFrame(() => place(target, step.placement)); }
}
/** Comma-separated selectors are tried in order: the first one present wins (a fallback list, not document order). */
const findTarget = sel => sel.split(',').map(s => s.trim()).map(s => document.querySelector(s)).find(Boolean) || null;
function reposition() { if (!current) return; const step = current.tour.steps[current.index]; place(step.target ? findTarget(step.target) : null, step.placement); }

/** The spotlight hugs the target; the card sits on the side with room, and points at it. */
function place(target, preferred) {
  const spot = $('tourSpot'); const card = $('tourCard'); const pad = 6;
  if (!target) { spot.hidden = true; card.className = 'tcard center'; card.style.left = card.style.top = ''; return; }
  spot.hidden = false;
  const r = target.getBoundingClientRect();
  Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  const W = innerWidth, H = innerHeight; const cw = Math.min(340, W - 32); card.style.width = `${cw}px`;
  const ch = card.offsetHeight || 200; const gap = 14;
  const room = { right: W - r.right - gap, left: r.left - gap, below: H - r.bottom - gap, above: r.top - gap };
  const order = preferred ? [preferred, 'right', 'left', 'below', 'above'] : ['right', 'left', 'below', 'above'];
  const fits = s => (s === 'right' || s === 'left') ? room[s] >= cw : room[s] >= ch;
  const side = order.find(fits) || ['above', 'below', 'right', 'left'].sort((a, b) => room[b] - room[a])[0];   // nothing fits: take the roomiest side and clamp
  let left, top;
  if (side === 'right') { left = r.right + gap; top = r.top; }
  else if (side === 'left') { left = r.left - gap - cw; top = r.top; }
  else if (side === 'below') { left = r.left; top = r.bottom + gap; }
  else { left = r.left; top = r.top - gap - ch; }
  left = Math.max(12, Math.min(left, W - cw - 12)); top = Math.max(12, Math.min(top, H - ch - 12));
  card.className = `tcard ${side}`; card.style.left = `${left}px`; card.style.top = `${top}px`;
  const arrow = card.querySelector('.tarrow') || card.appendChild(Object.assign(document.createElement('i'), { className: 'tarrow' }));
  const ax = Math.max(14, Math.min(r.left + r.width / 2 - left, cw - 14)); const ay = Math.max(14, Math.min(r.top + r.height / 2 - top, ch - 14));
  arrow.style.left = side === 'below' || side === 'above' ? `${ax}px` : ''; arrow.style.top = side === 'left' || side === 'right' ? `${ay}px` : '';
}

function onKey(e) {
  if (!current) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(true); }
  else if (e.key === 'ArrowRight' || e.key === 'Enter') { if (e.target.closest && e.target.closest('input, textarea')) return; e.preventDefault(); e.stopPropagation(); next(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); back(); }
}
export function init() {
  $('sheet').addEventListener('close', () => { if (current) { showOverlay(true); requestAnimationFrame(reposition); } });
  $('tour').addEventListener('click', e => {
    const b = e.target.closest('[data-tour-act]'); if (!b) return;
    ({ next, back, skip: () => stop(true) })[b.dataset.tourAct]();
  });
  $('tourVeil').addEventListener('click', () => { /* clicks on the veil do nothing: the tour owns the screen until Skip or Esc */ });
}
/** Steps can ask the engine to re-place after the app re-renders. */
export function onRender() { if (current) requestAnimationFrame(reposition); }
