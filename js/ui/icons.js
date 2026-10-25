// Line icons in the Podium style: 24px grid, 2px square-capped stroke, mitred
// joins (the .icon class in app.css). They inherit the text color and are
// never violet on their own.

const svg = (body, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  home: svg('<path d="M4 10.5 12 4l8 6.5V20h-5.5v-6h-5v6H4z"/>'),
  scores: svg('<rect x="3" y="5" width="18" height="14"/><path d="M12 5v14M6.5 10h2M6.5 14h2M15.5 10h2M15.5 14h2"/>'),
  // "standings" in the system is the podium silhouette — used for Ratings
  standings: svg('<path d="M3 20v-8h6V6h6v9h6v5z"/>'),
  explore: svg('<path d="M4 4v16h16"/><rect x="7.5" y="13" width="2" height="2"/><rect x="11.5" y="9" width="2" height="2"/><rect x="15.5" y="11" width="2" height="2"/><rect x="17.5" y="5" width="2" height="2"/>'),
  more: svg('<path d="M5 12h2M11 12h2M17 12h2"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  chevron: svg('<path d="M9 5l7 7-7 7"/>', 'icon chev'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  up: svg('<path d="M6 15l6-6 6 6"/>'),
  search: svg('<path d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 20 20"/>'),
  star: svg('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>'),
  starFilled: svg('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="currentColor"/>'),
  book: svg('<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4zM9 20a4 4 0 0 1-4-4"/>'),
  settings: svg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><rect x="14" y="5" width="4" height="4"/><rect x="6" y="15" width="4" height="4"/>'),
  signal: svg('<path d="M5 19v-3M10 19v-7M15 19V9M20 19V5"/>'),
  link: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>'),
  scoreboard: svg('<rect x="3" y="5" width="18" height="14"/><path d="M12 5v14"/>'),
  scatter: svg('<path d="M4 4v16h16"/><rect x="7.5" y="13" width="2" height="2"/><rect x="11.5" y="9" width="2" height="2"/><rect x="15.5" y="11" width="2" height="2"/><rect x="17.5" y="5" width="2" height="2"/>'),
  chart: svg('<path d="M3 20v-8h6V6h6v9h6v5z"/>'),
  share: svg('<path d="M12 3v12M8 7l4-4 4 4M6 11H4v10h16V11h-2"/>'),
  phone: svg('<rect x="7" y="3" width="10" height="18"/><path d="M11 18h2"/>'),
  bulb: svg('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>'),
};
