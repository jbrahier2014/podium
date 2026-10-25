// Tiny DOM helpers so views stay readable without a framework.
//
//   h('div', { class: 'card', onclick: fn }, 'text', childEl)
//
// - attributes starting with "on" become event listeners
// - "style" may be a string or an object (keys starting with -- set CSS variables)
// - "dataset" is an object of data-* values
// - children can be strings, nodes, arrays, or null/false (skipped)

export { ICONS } from '../ui/icons.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (val == null) continue;
        if (prop.startsWith('--')) el.style.setProperty(prop, val);
        else el.style[prop] = val;
      }
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else if (k === 'html') {
      el.innerHTML = v; // only ever used with trusted, static markup (icons)
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Turn static SVG markup (trusted strings only) into an element. */
export function icon(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

/** Remove all children. */
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

/** Brief message near the bottom of the screen. */
let toastTimer;
export function toast(msg, ms = 2400) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/** Bottom sheet. Returns { close, body }. */
export function openSheet(title, { onClose } = {}) {
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const body = h('div', { class: 'sheet-body' });
  const close = () => {
    removeEventListener('hashchange', close);
    backdrop.remove(); sheet.remove(); document.body.style.overflow = ''; onClose && onClose();
  };
  addEventListener('hashchange', close); // navigating away closes the sheet
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-grabber' }),
    h('div', { class: 'sheet-head' }, h('span'), h('h3', {}, title), h('button', { class: 'done', onclick: close }, 'Done')),
    body);
  backdrop.addEventListener('click', close);
  document.body.append(backdrop, sheet);
  document.body.style.overflow = 'hidden';
  return { close, body };
}
