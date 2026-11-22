// Shared tuning. World coordinates: x right, y up, -z is "north" (the general direction of the core).
// Racers are axis-aligned boxes; the course is axis-aligned boxes plus ramps.

export const BODY_R = 0.3;         // half-width of the racer's collision box
export const STAND_H = 1.8;
export const SLIDE_H = 0.95;
export const EYE_H = 1.64;         // standing eye height above feet
export const SLIDE_EYE_H = 0.82;
export const STEP_H = 0.45;        // auto step-up while running

// Base racer stats. Upgrades multiply/add on top of these.
export const BASE_STATS = {
  maxSpeed: 8.6,        // m/s sprint on flat ground, no flow (precision parkour, not a sprint race)
  accel: 11,            // m/s^2 near top speed (more at low speed)
  jumpV: 8.0,           // initial jump velocity (≈1.45 m apex)
  gravity: 22,
  airControl: 15,       // m/s^2 of steering in the air (redirects, never adds speed past takeoff)
  turnRate: 14,         // how fast ground velocity swings to the wish direction (1/s)
  slideTime: 0.9,
  slideFriction: 2.2,   // m/s^2 lost while sliding on flat ground
  wallrunTime: 1.25,
  wallrunGravity: 0.38, // fraction of gravity while wallrunning
  wallrunLift: 3.4,     // vertical speed given when the wall is caught
  wallBoost: 0.8,       // speed added when catching a wall
  wallJumpPush: 6.0,    // sideways speed off the wall
  kickV: 7.7,           // UT-style wall kick: vertical speed when kicking off any wall mid-air
  kickPush: 5.6,        // ...and speed straight away from the wall
  maxKicks: 3,          // wall kicks per airborne chain (resets on landing)
  climbSpeed: 6.4,      // vertical speed of a wall climb
  climbTime: 0.5,
  mantleReach: 1.75,    // a ledge this far above the feet can be grabbed
  hardLand: 14.8,       // landing speed above which a landing hurts (≈5 m fall)
  hardLandKeep: 0.35,   // fraction of speed kept on a hard landing
  stunTime: 0.45,
  rollWindow: 0.32,     // press slide this long before touchdown to roll
  flowBonus: 0.12,      // top-speed bonus at full flow
  flowGain: 0.2,        // flow gained per clean move
  // coil (Mirror's Edge tuck): slide pressed while rising / near the apex pulls the legs up,
  // so the feet clear a lip up to tuckLift higher for tuckTime seconds
  tuckLift: 0.5,
  tuckTime: 0.42,
  // grapple: fire at an anchor node ahead (within hookCone of the view, above you, in range);
  // the hook flies at hookSpeed, so it has to be fired on the run-up. Hold to swing, let go
  // (or jump) to release; entry speed is swing energy: faster in = higher, longer flight.
  hookRange: 30,
  hookSpeed: 28,
  hookCone: 0.42,       // half-angle (rad) around the view
  hookChest: 1.2,       // the rope pulls at chest height
  swingJumpV: 4.5,      // upward kick when jumping out of a swing
  grappleBuffer: 0.3,   // a held press keeps trying to fire this long (chaining posts)
  // pivot (horizontal grapple): fire at a post beside the line, the tether whips you round it
  pivotRange: 16,
  pivotCone: 1.2,       // wide: the post is off to the side as you pass it
  pivotHookSpeed: 45,   // the tether to a post is short: it bites almost at once
  pivotMinR: 1.6,       // tightest turn radius
  pivotMinSpeed: 8,     // a turn always carries at least this much
  pivotBoost: 0.6,      // speed added when the tether goes taut
  pivotGravity: 0.1,    // fraction of gravity felt while the line carries you
  pivotDamp: 5,         // how fast a fall settles once the line takes the weight
  pivotMaxTurn: 3.5,    // radians: past a U-turn the line lets go by itself
  coyote: 0.11,
  jumpBuffer: 0.13,
};

// Speed the generator assumes when sizing gaps (conservative: below top speed).
export const GEN_SPEED = 7.2;
