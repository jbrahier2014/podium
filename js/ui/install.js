// "Add to Home Screen" help. Podium is a web app: installed from Safari it opens
// full screen from its own icon, like any other app.

import { h, icon, ICONS, openSheet } from '../util/dom.js';

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isTouch = () => matchMedia('(pointer: coarse)').matches;
const KEY = 'podium.installTip';

const STEPS = [
  ['Open in Safari', 'Go to jbrahier2014.github.io/podium in Safari (not Chrome or an in-app browser).'],
  ['Tap Share', 'The square with an arrow pointing up: at the bottom of the screen, or behind the \u2026 button next to the address.'],
  ['Add to Home Screen', 'Scroll the list down if you don\u2019t see it. Keep \u201cOpen as Web App\u201d on, then tap Add.'],
  ['Open Podium from its icon', 'It runs full screen, opens instantly, works offline with your last data, and updates itself when a new version is published.'],
];

export function openInstallHelp() {
  const { body } = openSheet('Put Podium on your Home Screen');
  body.append(
    h('ol', { class: 'install-steps' }, STEPS.map(([t, d]) => h('li', {}, h('div', { class: 'title' }, t), h('div', { class: 'sub' }, d)))),
    h('p', { class: 'footnote', style: { margin: 'var(--space-3) var(--gutter) var(--space-6)' } },
      'The Home Screen app keeps its own settings, so pick your featured teams and theme again inside it the first time.'));
}

/** One-time tip on Home, in a phone browser only. */
export function installTip() {
  if (isStandalone() || !isTouch()) return null;
  try { if (localStorage.getItem(KEY) === 'dismissed') return null; } catch { /* storage blocked: still show */ }
  const el = h('div', { class: 'install-tip' },
    h('span', { class: 'it-icon' }, icon(ICONS.share)),
    h('button', { class: 'it-text', onclick: () => openInstallHelp() },
      h('div', { class: 'title' }, 'Add Podium to your Home Screen'),
      h('div', { class: 'sub' }, 'Share, then Add to Home Screen. Tap for steps.')),
    h('button', { class: 'icon-btn it-close', 'aria-label': 'Dismiss', onclick: () => {
      try { localStorage.setItem(KEY, 'dismissed'); } catch { /* ignore */ }
      el.remove();
    } }, '\u00d7'));
  return el;
}
