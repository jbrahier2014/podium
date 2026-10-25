# Podium

John's personal sports stats app: scores, box scores, schedules, standings and deep team
statistics for college football (FBS), MLB and the NFL. No news, articles or video.

Live at **https://jbrahier2014.github.io/podium/**

## On your iPhone

1. Open https://jbrahier2014.github.io/podium/ in **Safari**.
2. Tap **Share** (square with an up arrow; on newer iOS it may be behind the **…** button).
3. Tap **Add to Home Screen** (scroll down the list if needed), keep **Open as Web App** on, tap **Add**.
4. Open Podium from its icon: full screen, instant start, works offline with the last data
   it saw, and updates itself after each publish.

The Home Screen app keeps its own settings (featured teams, theme), separate from Safari.
The app also has these steps under **More → Add to Home Screen**.

## Everyday use of this folder

| Double-click | What it does |
|---|---|
| `1-SETUP.cmd` | One time only: installs Git + GitHub CLI, signs you in, creates the repo, turns on Pages |
| `2-PUBLISH-UPDATE.cmd` | Uploads whatever has changed in this folder and stamps a new app version; the site and installed apps update a minute later |
| `add-cfbd-key.cmd` | Saves your CollegeFootballData API key as a GitHub secret (used only by the nightly Action) |

## How the code is organized

No build step: the browser runs these files directly, so you can edit any file and publish.

```
index.html              App frame: nav bar, tab bar, iOS home-screen tags
manifest.webmanifest    App name, icons, standalone mode
sw.js                   Service worker: offline support, instant startup
css/tokens.css          Podium design tokens (colors, type, spacing) from the design system
css/app.css             All app styles, built only from those tokens
js/app.js               Entry point
js/router.js            Screens and the back-button/tab behavior
js/leagues.js           League definitions, season windows, season years
js/util/                DOM helpers, Eastern-time formatting
js/ui/                  Podium components (ScoreCard, StatBar, StandingsTable, badges), icons, the mark
js/store/settings.js    Featured teams, refresh interval, theme (localStorage)
js/store/cache.js       IndexedDB cache; completed games are never refetched
js/data/index.js        The ONE place screens get data from
js/data/providers/      ESPN (NFL, CFB) and MLB Stats API adapters — swap these if a source changes
js/data/glossary.js     Every stat's definition and formula
js/views/               One file per screen
data/                   JSON written by the GitHub Actions (team lists, advanced stats, ratings)
scripts/                Scripts the GitHub Actions run (never loaded by the app)
.github/workflows/      The scheduled GitHub Actions
tools/make_icons.py     Regenerates the app icon and launch screens
design/                 The Podium design system docs (principles, logo, voice, tokens)
assets/fonts/           Space Grotesk and Inter, self-hosted so the app works offline
```

Player stats are planned as a later add-on: they get their own functions in
`js/data/index.js` and their own screens, without changing the team code.

## Build phases (all done)

1. GitHub setup, repo, Pages, PWA shell
2. Live scores for all three leagues
3. Game detail
4. Team pages and standings
5. GitHub Action: advanced stats and power ratings
6. Stat Explorer
7. Live expected points (football), team logos, polish and home-screen app behavior
