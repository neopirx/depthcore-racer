import { Racer } from './racer.js';

export const RACE_STEP = 1 / 120;
export const MAX_TICKS = 120 * 600;
const FLAGS = ['jump', 'jumpHeld', 'slide', 'slideHeld', 'grapple', 'grappleHeld'];
// Preserve input floats exactly: server validation and the ghost use the same physics ticks.
export function packInput(input) {
  return [input.fwd || 0, input.side || 0, input.yaw || 0, FLAGS.reduce((bits, key, i) => bits | (input[key] ? 1 << i : 0), 0)];
}
export function unpackInput(row) {
  const input = { fwd: row[0], side: row[1], yaw: row[2] };
  FLAGS.forEach((key, i) => { input[key] = !!(row[3] & (1 << i)); });
  return input;
}
export function validateReplay(inputs) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > MAX_TICKS) throw new Error('Run must be under 10 minutes.');
  for (const row of inputs) {
    if (!Array.isArray(row) || row.length !== 4 || !row.every(Number.isFinite)
      || Math.abs(row[0]) > 1 || Math.abs(row[1]) > 1 || Math.abs(row[2]) > 1e6
      || !Number.isInteger(row[3]) || row[3] < 0 || row[3] > 63) throw new Error('Invalid run inputs.');
  }
}
export class GhostReplay {
  constructor(track, inputs) {
    this.racer = new Racer(track, {}, 'ghost');
    this.inputs = inputs;
    this.tick = 0;
  }
  step() {
    if (this.tick < this.inputs.length && !this.racer.finished) {
      this.racer.step(RACE_STEP, unpackInput(this.inputs[this.tick++]));
    }
  }
}
export function verifyRun(track, inputs) {
  validateReplay(inputs);
  const ghost = new GhostReplay(track, inputs);
  for (let tick = 0; tick < inputs.length; tick++) {
    ghost.step();
    ghost.racer.events.length = 0;
    if (ghost.racer.finished && tick !== inputs.length - 1) throw new Error('Run continues after the finish.');
  }
  if (!ghost.racer.finished) throw new Error('Run did not reach the finish.');
  return { time: ghost.racer.finishTime, falls: ghost.racer.falls, cleans: ghost.racer.cleans };
}
