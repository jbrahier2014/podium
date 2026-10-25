// Definitions for every stat the nightly job writes (data/<league>/<season>.json).
// One place for labels, formatting and direction, used by Ratings, the team Advanced
// tab, the fingerprint chart, Home's "Did you know?" and (phase 6) the Stat Explorer.
//
//   key     field in team.v
//   label   full name;  short: column header
//   group   section on the Advanced tab
//   fmt     'dec1' 'dec2' 'dec3' 'pct' (0.423 -> 42.3%) 'int' 'signed1' 'signed0' 'avg' (.312) 'rec' (text)
//   hib     true = higher is better, false = lower is better, null = neither (style stats)
//   fp      true = part of the ~15-stat percentile fingerprint

const D = (key, label, short, group, fmt, hib, fp = false) => ({ key, label, short, group, fmt, hib, fp });

export const STATS = {
  cfb: [
    D('pred', 'Predictor rating', 'Pred', 'Ratings', 'dec1', true, true),
    D('elo', 'Elo rating', 'Elo', 'Ratings', 'int', true),
    D('srs', 'Simple Rating System', 'SRS', 'Ratings', 'dec1', true),
    D('sp', 'SP+', 'SP+', 'Ratings', 'dec1', true),
    D('sos', 'Strength of schedule', 'SOS', 'Ratings', 'dec1', true, true),
    D('ppg', 'Points per game', 'PPG', 'Scoring', 'dec1', true),
    D('papg', 'Points allowed per game', 'PA/G', 'Scoring', 'dec1', false),
    D('o_epa', 'EPA per play', 'EPA', 'Offense', 'dec3', true, true),
    D('o_sr', 'Success rate', 'SR', 'Offense', 'pct', true, true),
    D('o_expl', 'Explosiveness', 'Expl', 'Offense', 'dec2', true, true),
    D('o_ppo', 'Points per scoring opportunity', 'Pts/Opp', 'Offense', 'dec2', true, true),
    D('o_pass_epa', 'Passing EPA per play', 'Pass EPA', 'Offense', 'dec3', true),
    D('o_rush_epa', 'Rushing EPA per play', 'Rush EPA', 'Offense', 'dec3', true),
    D('o_pass_sr', 'Passing success rate', 'Pass SR', 'Offense', 'pct', true),
    D('o_rush_sr', 'Rushing success rate', 'Rush SR', 'Offense', 'pct', true),
    D('o_line', 'Line yards per carry', 'Line yds', 'Offense', 'dec2', true, true),
    D('o_stuff', 'Stuff rate allowed', 'Stuffed', 'Offense', 'pct', false),
    D('o_havoc', 'Havoc allowed', 'Havoc', 'Offense', 'pct', false),
    D('o_fp', 'Average starting field position', 'Start', 'Offense', 'dec1', true, true),
    D('d_epa', 'EPA per play allowed', 'EPA', 'Defense', 'dec3', false, true),
    D('d_sr', 'Success rate allowed', 'SR', 'Defense', 'pct', false, true),
    D('d_expl', 'Explosiveness allowed', 'Expl', 'Defense', 'dec2', false, true),
    D('d_ppo', 'Points per opportunity allowed', 'Pts/Opp', 'Defense', 'dec2', false),
    D('d_pass_epa', 'Passing EPA allowed', 'Pass EPA', 'Defense', 'dec3', false),
    D('d_rush_epa', 'Rushing EPA allowed', 'Rush EPA', 'Defense', 'dec3', false),
    D('d_havoc', 'Havoc rate', 'Havoc', 'Defense', 'pct', true, true),
    D('d_stuff', 'Stuff rate', 'Stuff', 'Defense', 'pct', true),
    D('d_line', 'Line yards allowed', 'Line yds', 'Defense', 'dec2', false),
    D('d_fp', 'Opponent starting field position', 'Opp start', 'Defense', 'dec1', false),
    D('o_ypp', 'Yards per play', 'YPP', 'Traditional', 'dec2', true),
    D('d_ypp', 'Yards per play allowed', 'YPP alw', 'Traditional', 'dec2', false),
    D('to_margin', 'Turnover margin', 'TO +/-', 'Traditional', 'signed0', true, true),
    D('o_3rd', 'Third-down conversion %', '3rd %', 'Traditional', 'pct', true),
    D('d_3rd', 'Opponent third-down %', 'Opp 3rd', 'Traditional', 'pct', false),
    D('o_rz', 'Red-zone TD %', 'RZ TD %', 'Traditional', 'pct', true),
    D('d_rz', 'Opponent red-zone TD %', 'Opp RZ', 'Traditional', 'pct', false),
    D('sacks', 'Sacks', 'Sacks', 'Traditional', 'int', true),
    D('sacks_allowed', 'Sacks allowed', 'Sk alw', 'Traditional', 'int', false),
    D('talent', 'Talent composite', 'Talent', 'Roster', 'dec1', true, true),
    D('ret_ppa', 'Returning production', 'Returning', 'Roster', 'pct', true),
  ],
  nfl: [
    D('srs', 'Simple Rating System', 'SRS', 'Ratings', 'dec1', true, true),
    D('elo', 'Elo rating', 'Elo', 'Ratings', 'int', true),
    D('pyth_w', 'Pythagorean wins', 'Pyth W', 'Ratings', 'dec1', true),
    D('luck', 'Luck (wins minus Pythagorean)', 'Luck', 'Ratings', 'signed1', null),
    D('pd', 'Point differential', 'Diff', 'Scoring', 'signed0', true),
    D('ppg', 'Points per game', 'PPG', 'Scoring', 'dec1', true),
    D('papg', 'Points allowed per game', 'PA/G', 'Scoring', 'dec1', false),
    D('o_epa', 'EPA per play', 'EPA', 'Offense', 'dec3', true, true),
    D('o_pass_epa', 'Passing EPA per play', 'Pass EPA', 'Offense', 'dec3', true, true),
    D('o_rush_epa', 'Rushing EPA per play', 'Rush EPA', 'Offense', 'dec3', true, true),
    D('o_sr', 'Success rate', 'SR', 'Offense', 'pct', true, true),
    D('o_expl', 'Explosive play rate', 'Expl', 'Offense', 'pct', true, true),
    D('ed_pass', 'Early-down pass rate', 'ED pass', 'Offense', 'pct', null),
    D('cpoe', 'Completion % over expected', 'CPOE', 'Offense', 'signed1', true, true),
    D('o_3rd', 'Third-down conversion %', '3rd %', 'Offense', 'pct', true, true),
    D('o_rz', 'Red-zone TD %', 'RZ TD %', 'Offense', 'pct', true, true),
    D('sacks_allowed', 'Sacks allowed', 'Sk alw', 'Offense', 'int', false),
    D('d_epa', 'EPA per play allowed', 'EPA', 'Defense', 'dec3', false, true),
    D('d_pass_epa', 'Passing EPA allowed', 'Pass EPA', 'Defense', 'dec3', false, true),
    D('d_rush_epa', 'Rushing EPA allowed', 'Rush EPA', 'Defense', 'dec3', false, true),
    D('d_sr', 'Success rate allowed', 'SR', 'Defense', 'pct', false, true),
    D('d_expl', 'Explosive plays allowed', 'Expl', 'Defense', 'pct', false),
    D('d_3rd', 'Opponent third-down %', 'Opp 3rd', 'Defense', 'pct', false),
    D('d_rz', 'Opponent red-zone TD %', 'Opp RZ', 'Defense', 'pct', false),
    D('sacks', 'Sacks', 'Sacks', 'Defense', 'int', true, true),
    D('to_margin', 'Turnover margin', 'TO +/-', 'Turnovers', 'signed0', true, true),
  ],
  mlb: [
    D('rd', 'Run differential', 'RD', 'Results', 'signed0', true, true),
    D('pyth_w', 'Pythagorean wins', 'Pyth W', 'Results', 'dec1', true),
    D('luck', 'Luck (wins minus Pythagorean)', 'Luck', 'Results', 'signed1', null),
    D('rpg', 'Runs per game', 'R/G', 'Results', 'dec2', true),
    D('rapg', 'Runs allowed per game', 'RA/G', 'Results', 'dec2', false),
    D('avg', 'Batting average', 'AVG', 'Hitting', 'avg', true),
    D('obp', 'On-base %', 'OBP', 'Hitting', 'avg', true),
    D('slg', 'Slugging %', 'SLG', 'Hitting', 'avg', true),
    D('ops', 'OPS', 'OPS', 'Hitting', 'avg', true, true),
    D('woba', 'wOBA', 'wOBA', 'Hitting', 'avg', true, true),
    D('iso', 'Isolated power', 'ISO', 'Hitting', 'avg', true, true),
    D('babip', 'BABIP', 'BABIP', 'Hitting', 'avg', null),
    D('k_pct', 'Strikeout rate', 'K%', 'Hitting', 'pct', false, true),
    D('bb_pct', 'Walk rate', 'BB%', 'Hitting', 'pct', true, true),
    D('woba_vl', 'wOBA vs left-handers', 'vs LHP', 'Splits', 'avg', true),
    D('woba_vr', 'wOBA vs right-handers', 'vs RHP', 'Splits', 'avg', true),
    D('ops_home', 'OPS at home', 'Home', 'Splits', 'avg', true),
    D('ops_away', 'OPS on the road', 'Road', 'Splits', 'avg', true),
    D('era', 'ERA', 'ERA', 'Pitching', 'dec2', false, true),
    D('fip', 'FIP', 'FIP', 'Pitching', 'dec2', false, true),
    D('whip', 'WHIP', 'WHIP', 'Pitching', 'dec2', false),
    D('kbb_pct', 'K-BB%', 'K-BB%', 'Pitching', 'pct', true, true),
    D('hr9', 'Home runs per nine', 'HR/9', 'Pitching', 'dec2', false),
    D('sp_era', 'Rotation ERA', 'SP ERA', 'Rotation & bullpen', 'dec2', false),
    D('sp_fip', 'Rotation FIP', 'SP FIP', 'Rotation & bullpen', 'dec2', false),
    D('rp_era', 'Bullpen ERA', 'RP ERA', 'Rotation & bullpen', 'dec2', false, true),
    D('rp_fip', 'Bullpen FIP', 'RP FIP', 'Rotation & bullpen', 'dec2', false),
    D('brl', 'Barrel %', 'Brl%', 'Statcast', 'pct', true, true),
    D('hh', 'Hard-hit %', 'HH%', 'Statcast', 'pct', true),
    D('xwoba', 'xwOBA', 'xwOBA', 'Statcast', 'avg', true, true),
    D('brl_a', 'Barrel % allowed', 'Brl% alw', 'Statcast', 'pct', false),
    D('hh_a', 'Hard-hit % allowed', 'HH% alw', 'Statcast', 'pct', false, true),
    D('xwoba_a', 'xwOBA allowed', 'xwOBA alw', 'Statcast', 'avg', false, true),
  ],
};

export const statDef = (league, key) => STATS[league].find((s) => s.key === key);

/** Format a value for display. */
export function fmt(value, f) {
  if (value == null || value === '' || Number.isNaN(value)) return '–';
  if (f === 'rec') return String(value);
  const v = Number(value);
  switch (f) {
    case 'pct': return `${(v * 100).toFixed(1)}%`;
    case 'avg': return v.toFixed(3).replace(/^(-?)0\./, '$1.');
    case 'int': return String(Math.round(v));
    case 'dec1': return v.toFixed(1);
    case 'dec2': return v.toFixed(2);
    case 'dec3': return v.toFixed(3);
    case 'signed0': return `${v > 0 ? '+' : ''}${Math.round(v)}`;
    case 'signed1': return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
    default: return String(value);
  }
}

/**
 * League percentile and rank of every team for one stat.
 * Percentile: 100 = best in the league, 0 = worst (direction from hib).
 * Returns Map teamId -> { pct, rank, n }.
 */
export function percentiles(teams, def) {
  const vals = teams.map((t) => ({ id: t.id, v: t.v[def.key] })).filter((x) => typeof x.v === 'number' && !Number.isNaN(x.v));
  const n = vals.length;
  const sign = def.hib === false ? -1 : 1;
  const out = new Map();
  for (const x of vals) {
    const better = vals.filter((y) => sign * y.v > sign * x.v).length;
    const worse = vals.filter((y) => sign * y.v < sign * x.v).length;
    out.set(x.id, { pct: n > 1 ? Math.round((100 * worse) / (n - 1)) : 50, rank: better + 1, n });
  }
  return out;
}

export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd']; const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export const SCOPE = { cfb: 'FBS', nfl: 'the NFL', mlb: 'MLB' };
