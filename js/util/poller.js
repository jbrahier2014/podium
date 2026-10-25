// Live polling that only runs while it should.
//
//   const stop = livePoller({ tick, isLive, intervalMs })
//
// - tick(): fetches fresh data and re-renders; returns the latest games (or
//   anything isLive understands)
// - isLive(result): true while polling should continue (a game is in progress)
// - intervalMs(): read each time, so a Settings change applies immediately
// Polling pauses while the app is in the background and catches up on return.

export function livePoller({ tick, isLive, intervalMs, initial }) {
  let timer = null;
  let stopped = false;
  let live = initial === undefined ? false : !!isLive(initial);
  let lastRun = Date.now();

  const schedule = () => {
    clearTimeout(timer);
    if (stopped || !live || document.visibilityState !== 'visible') return;
    timer = setTimeout(run, intervalMs());
  };

  async function run() {
    if (stopped) return;
    lastRun = Date.now();
    try {
      const result = await tick();
      live = !!isLive(result);
    } catch {
      // keep trying while live; the screen shows the last good data
    }
    schedule();
  }

  const onVisible = () => {
    if (document.visibilityState !== 'visible') { clearTimeout(timer); return; }
    if (live && Date.now() - lastRun >= intervalMs()) run();
    else schedule();
  };
  document.addEventListener('visibilitychange', onVisible);
  schedule();

  return {
    stop() { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); },
    /** Call after a manual refresh so polling starts/stops to match. */
    update(result) { live = !!isLive(result); schedule(); },
  };
}
