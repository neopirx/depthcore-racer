// The module catalogue: every set-piece the generator / editor can place, with what the course
// planner needs to know about it. One table instead of special cases scattered through the fill loop.
//
//   w(s)    pick weight in planner state s = { diff, h, last, lateral, canTurn, up }
//   turn    turns the route 90° (honours an explicit td heading north)
//   family  grapple pieces never follow each other; fork pieces neither (one choice at a time)
//   precise small-target hops: never straight after a fast exit (you'd overshoot them)
//   fast    exits fast (ramp, rolled drop, whip): the next piece mustn't be a precise one
//   calmIn  sized for a normal entry speed (speed checks): never straight after a fast exit
//   rises   a big climb: afterwards the planner may ask for a way down
//   desc    one line for the editor

export const CATALOG = {
  flyover: { w: () => 0, family: 'stack', rises: true, desc: 'climbing loop crossing above its approach; diagonal jump cut' },
  helix: { w: () => 0, family: 'stack', rises: true, desc: 'three-storey spiral with stacked return legs and a jump cut' },
  dive: { w: () => 0, family: 'stack', down: true, fast: true, desc: 'descending loop diving underneath its approach' },
  run: { w: (s) => (s.last === 'run' ? 0 : 0.15), desc: 'plain runway' },
  gap: { w: () => 1.4, desc: 'jump a gap (up / down / jogged sideways)' },
  stairs: { w: (s) => (s.up ? 1.0 + s.diff * 0.4 : 0), precise: true, desc: 'zig-zag hops up narrow steps' },
  pads: { w: (s) => 0.4 + s.diff * 0.7, precise: true, desc: 'hops across floating pillars' },
  ledge: { w: (s) => (s.up ? 0.6 : 0), desc: 'jump + mantle onto a ledge' },
  climb: { w: (s) => (s.up ? 0.9 + s.diff * 0.3 : 0), desc: 'wall climb' },
  ascent: { w: (s) => (s.up && s.h < 18 ? 0.35 + s.diff * 0.5 : 0), rises: true, desc: 'stacked climbs' },
  vault: { w: () => 0.5, desc: 'vault a barrier' },
  slide: { w: () => 0.55, desc: 'slide under a gate / duct' },
  beam: { w: (s) => 0.2 + s.diff * 0.5, precise: true, desc: 'balance beam over the void' },
  ramp: { w: (s) => (s.h > -15 ? 0.35 : 0), fast: true, down: true, desc: 'slide down a ramp' },
  drop: { w: (s) => (s.h > -20 ? 0.4 + s.diff * 0.3 : 0), fast: true, down: true, desc: 'big drop: roll it' },
  cascade: { w: (s) => (s.h > -15 ? 0.35 + s.diff * 0.4 : 0), precise: true, fast: true, down: true, desc: 'hops down narrow plates, then a drop' },
  gauntlet: { w: (s) => 0.35 + s.diff * 0.3, desc: 'vault / slide rhythm corridor' },
  gallery: { w: () => 0.4, calmIn: true, desc: 'covered passage with a vault or gate' },
  shuttle: { w: (s) => 0.4 + s.diff * 0.5, precise: true, desc: 'moving platforms' },

  wallrun: { w: (s) => 1.0 + s.diff * 0.5, fast: true, desc: 'wallrun across a gap' },
  wallchain: { w: (s) => (s.up ? 0.6 + s.diff * 0.9 : 0), fast: true, rises: true, desc: 'alternating wallruns up to a ledge' },
  pillarkick: { w: (s) => 0.5 + s.diff * 0.6, desc: 'kick off a pillar across a long gap' },
  tictac: { w: (s) => (s.up ? 0.45 + s.diff * 0.6 : 0), rises: true, desc: 'kick off a pillar up to a high ledge' },
  kickchain: { w: (s) => 0.3 + s.diff * 0.6, fast: true, desc: 'two pillar kicks across one gap' },

  climbkick: { w: (s) => (s.canTurn && s.up ? 0.5 + s.diff * 0.7 : 0), turn: true, rises: true, desc: 'climb, kick off sideways: 90° turn' },
  zigzag: { w: (s) => (s.canTurn && s.up && s.h < 23 ? 0.3 + s.diff * 0.6 : 0), turn: true, rises: true, pair: 'zig', desc: 'two climb-kicks: stairwell' },
  kick: { w: (s) => (s.canTurn ? 0.6 + s.diff * 0.6 : 0), turn: true, desc: 'wallrun, kick onto a side ledge: 90° turn' },
  corner: { w: (s) => (s.canTurn ? 0.3 : 0), turn: true, desc: 'corner (sometimes with a cut over a pad)' },
  turngap: { w: (s) => (s.canTurn ? 0.7 : 0), turn: true, calmIn: true, desc: 'turn and jump sideways' },

  swing: { w: (s) => 0.35 + s.diff * 0.5, family: 'grapple', desc: 'grapple swing over a long gap' },
  pivot: { w: (s) => (s.canTurn ? 0.5 + s.diff * 0.6 : 0), turn: true, family: 'grapple', fast: true, desc: 'pivot post whip: 90° air turn' },
  slalom: { w: () => 0,   // parked: back-to-back pivots were too hard to read (one pivot per segment)
    family: 'grapple', fast: true, desc: 'two pivot whips across the void' },
  switchback: { w: (s) => (s.up && s.h < 23 ? 0.35 + s.diff * 0.6 : 0), rises: true, pair: 'zig', desc: 'two U-turns (climb-kicks, at most one pivot)' },

  chimney: { w: (s) => (s.up && s.h < 30 ? 0.4 + s.diff * 0.6 : 0), rises: true, fast: true, calmIn: true, desc: 'zig-zag wallruns up a narrow shaft to a high ledge' },
  wallclimb: { w: (s) => (s.up ? 0.6 + s.diff * 0.4 : 0), rises: true, desc: 'wallrun across a gap, wall-jump up onto a higher deck' },
  plunge: { w: (s) => (s.h > -16 ? 0.45 + s.diff * 0.3 : 0), family: 'fork', down: true, fast: true, desc: 'two storeys: drop through the hole and run under, or jump it and stay high' },
  mezzanine: { w: () => 0.45, family: 'fork', calmIn: true, desc: 'deck stacked over the lane: run under it, or kick up and run over it' },
  dropturn: { w: (s) => (s.canTurn && s.h > -16 ? 0.5 + s.diff * 0.3 : 0), turn: true, down: true, fast: true, desc: 'turn and jump off the side onto a leg a storey below' },
  vaultturn: { w: (s) => (s.canTurn ? 0.5 : 0), turn: true, desc: 'corner straight into a vault or a slide gate' },
  kickturn: { w: (s) => (s.canTurn ? 0.5 + s.diff * 0.5 : 0), turn: true, fast: true, desc: 'jump at a pillar past the corner, kick off it round onto the new leg' },
  vaultgap: { w: () => 0.6, calmIn: true, desc: 'vault a barrier and jump the gap straight off the landing' },
  slidegap: { w: () => 0.55, calmIn: true, desc: 'slide a gate at the edge, jump out of the slide across a long gap' },
  rooftops: { w: (s) => 0.6 + s.diff * 0.3, precise: true, desc: 'short rooftops at stepping heights: hop, hop, hop' },
  alley: { w: (s) => 0.4 + s.diff * 0.5, fast: true, desc: 'wallrun, kick across to the opposite wall, ride it out' },

  bypass: { w: (s) => (s.up ? 0.5 + s.diff * 0.4 : 0.3), family: 'fork', precise: true, fast: true, desc: 'fork: climb over, or wallrun the flank' },
  split: { w: (s) => 0.45 + s.diff * 0.3, family: 'fork', desc: 'fork: obstacle lane or long-gap lane' },
  overunder: { w: () => 0.45, family: 'fork', desc: 'fork: slide the duct or run over it' },
  triple: { w: (s) => 0.4 + s.diff * 0.3, family: 'fork', desc: '3 lanes: obstacles / wallrun / pads' },
  terrace: { w: (s) => (s.up ? 0.45 + s.diff * 0.3 : 0), family: 'fork', desc: 'two levels: low lane or block-hopping high lane' },
  speedtrap: { w: (s) => (s.h > -12 ? 0.4 + s.diff * 0.4 : 0), family: 'fork', down: true, calmIn: true, fast: true, desc: 'speed check: slide the ramp to clear the gap, or drop a level and climb' },
  speedcorner: { w: (s) => (s.canTurn && s.h > -12 ? 0.35 + s.diff * 0.4 : 0), turn: true, family: 'fork', down: true, calmIn: true, fast: true, desc: 'speed check: slide the ramp and jump the corner diagonally' },
};

/** Every module type the generator / editor can place. */
export const MODULE_TYPES = Object.keys(CATALOG);
/** Modules that turn the route 90° (td = -1 left, +1 right; ignored on a lateral leg: those always turn back north). */
export const TURN_TYPES = new Set(MODULE_TYPES.filter((t) => CATALOG[t].turn));

/** On a lateral leg that has run long enough: the ways back north. */
export const TURN_BACK = {
  kick: (s) => 0.5 + s.diff * 0.4,
  climbkick: (s) => 0.4 + s.diff * 0.5,
  turngap: () => 0.9,
  corner: () => 0.4,
  dropturn: (s) => (s.h > -16 ? 0.5 : 0),
  vaultturn: () => 0.5,
  kickturn: (s) => 0.4 + s.diff * 0.4,
  pivot: (s) => 0.5 + s.diff * 0.5,
  speedcorner: (s) => (s.h > -12 ? 0.3 + s.diff * 0.3 : 0),
};
/**
 * Same-spin patterns. The planner folds the route over itself: a spiral turns the same way 3–4
 * times while climbing (or diving), so later legs run over / under the earlier ones; a hairpin
 * turns twice and runs back beside the way in. Legs between the turns are kept short.
 *   SPIRAL_TURN[dir]  the turns (called with an explicit spin, from any heading)
 *   SPIRAL_LEG[dir]   what may sit between two turns
 */
export const SPIRAL_TURN = {
  up: { climbkick: 1.4, kick: 0.7, turngap: 0.5, corner: 0.25, kickturn: 0.8, pivot: 0.35, vaultturn: 0.5 },
  level: { kick: 0.8, turngap: 0.8, corner: 0.3, kickturn: 0.9, pivot: 0.45, vaultturn: 0.7, dropturn: 0.3 },
  down: { dropturn: 1.3, turngap: 0.8, kick: 0.5, corner: 0.3, speedcorner: 0.4, pivot: 0.35, vaultturn: 0.4 },
};
export const SPIRAL_LEG = {
  up: { climb: 1, ledge: 0.6, wallchain: 0.6, tictac: 0.7, chimney: 0.8, stairs: 0.5, wallclimb: 0.9, rooftops: 0.4, ascent: 0.4 },
  level: { gap: 0.6, wallrun: 0.7, pillarkick: 0.5, vaultgap: 0.7, slidegap: 0.6, pads: 0.4, beam: 0.3, kickchain: 0.4, rooftops: 0.7, alley: 0.6 },
  down: { drop: 1, cascade: 0.7, gap: 0.4, wallrun: 0.4, plunge: 0.8, vaultgap: 0.4, slidegap: 0.4, rooftops: 0.5 },
};

/** When the planner wants height back down. */
export const GO_DOWN = { drop: () => 1, ramp: () => 0.5, cascade: () => 0.8, speedtrap: (s) => (s.h > -12 ? 0.7 : 0), plunge: () => 0.8 };

/**
 * Weighted choice for the planner state. `ban` holds types that didn't fit here.
 * Returns the weights (0 = not allowed) so callers can pick or inspect.
 */
export function weights(s, ban) {
  const w = {};
  if (s.mustTurnBack) {
    for (const [t, f] of Object.entries(TURN_BACK)) w[t] = f(s);
  } else if (s.wantDown && s.h > -20) {
    for (const [t, f] of Object.entries(GO_DOWN)) w[t] = f(s);
  } else {
    const lastM = CATALOG[s.last] ?? {};
    for (const [t, m] of Object.entries(CATALOG)) {
      let x = m.w(s);
      if (s.lateral && m.turn) x = 0;
      if (t === s.last) x = 0;
      if (m.family && m.family === lastM.family) x = 0;      // one grapple / one fork at a time
      if (m.pair && m.pair === lastM.pair) x = 0;
      if (s.lastFast && (m.precise || m.calmIn)) x = 0;
      if (t === 'gap' && s.lastFast) x *= 0.5;
      if ((t === 'wallrun' || t === 'wallchain') && (s.last === 'wallrun' || s.last === 'wallchain')) x *= t === 'wallrun' ? 0.4 : 0.3;
      if (s.h > 22 && m.down) x *= t === 'drop' ? 3 : 2;
      w[t] = x;
    }
  }
  // entry rules hold in every branch: nothing precise or speed-sized straight after a fast exit
  if (s.lastFast) for (const t of Object.keys(w)) if (CATALOG[t].precise || CATALOG[t].calmIn) w[t] = 0;
  for (const k of ban) if (w[k] !== undefined) w[k] = 0;
  return w;
}
