// Tiny event bus so views can ask the app to re-render or navigate without importing it.
const target = new EventTarget();
export const on = (name, fn) => target.addEventListener(name, e => fn(e.detail));
export const emit = (name, detail) => target.dispatchEvent(new CustomEvent(name, { detail }));
