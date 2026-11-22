import { shared } from './shared.js';

// Music clock shared by the audio sequencer and every beat-reactive visual.
// When WebAudio is running the clock follows the audio context, so visuals sit exactly on the
// music; before that (title screen, autopilot, headless) it free-runs on frame time.
// The tempo follows whichever track is playing (fx/audio.js TRACKS sets it on every change).
let SPB = 60 / 92.04;
export function setTempo(bpm) { SPB = 60 / bpm; }

export const beat = {
  t: 0,            // beats elapsed (float)
  index: 0,        // integer beat
  bar: 0,          // integer bar (4 beats)
  phase: 0,        // 0..1 inside the current beat
  kick: 0,         // 1 on the beat, decays fast
  snare: 0,        // 1 on beats 2 & 4
  hat: 0,          // 16th pulses
  energy: 0.4,     // musical intensity 0..1 (follows the run: speed + flow)
  drop: 0,         // 1 on the first beat of every 8-bar phrase, slow decay
  source: null,    // () => seconds on the audio clock, or null
  live: null,      // { low, mid, onset } from the track analyser while the music plays
  _free: 0,
};


export function updateBeat(dt) {
  beat._free += dt;
  const sec = beat.source ? beat.source() : beat._free;
  const t = Math.max(0, sec / SPB);
  const idx = Math.floor(t);
  if (idx !== beat.index) {
    beat.index = idx;
    beat.bar = Math.floor(idx / 4);
    if (idx % 32 === 0) beat.drop = 1;
  }
  beat.t = t;
  beat.phase = t - idx;
  // clock pulse on each beat + its double-time offbeat; the live analyser's onsets ride on top
  const half = (t * 2) % 1;
  let kick = Math.max(Math.exp(-beat.phase * 7), Math.exp(-half * 9) * 0.55);
  if (beat.live) {
    beat._on = Math.max(beat.live.onset, (beat._on ?? 0) * Math.exp(-dt * 9));
    kick = Math.max(kick * 0.45, beat._on, beat.live.low * 0.35);
  }
  beat.kick = Math.min(1, kick);
  beat.snare = idx % 2 === 1 ? Math.exp(-beat.phase * 5) : 0;
  beat.hat = Math.exp(-((t * 4) % 1) * 9);
  beat.drop *= Math.exp(-dt * 0.5);
  shared.uBeat.value = t;
  shared.uKick.value = beat.kick * (0.45 + 0.55 * beat.energy);
  shared.uEnergy.value = beat.energy;
}
