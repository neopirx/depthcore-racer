import { beat, setTempo } from './beat.js';
import osbUrl from '../audio/music/Outer Space Breaks.mp3?url';
import osb2Url from '../audio/music/Outer Space Breaks_2.mp3?url';
import ddhUrl from '../audio/music/Degraded Digital Haze.mp3?url';
import hookUrl from '../audio/fx/grappling_hook.wav?url';
import jumpUrl from '../audio/fx/jump.wav?url';
import landUrl from '../audio/fx/land.wav?url';
import slideUrl from '../audio/fx/slide.wav?url';
import stepUrl from '../audio/fx/step.wav?url';

const SFX = { jump: jumpUrl, land: landUrl, slide: slideUrl, step: stepUrl, hook: hookUrl };

/**
 * The soundtrack. Each sector opens on its own track (sector N plays TRACKS[(N-1) % n]); a track
 * that runs out hands over to the next. bpm / offset (first downbeat, seconds) drive the beat
 * clock every visual pulses on — measured from the files (low-band onset phase fit).
 */
export const TRACKS = [
  { name: 'Outer Space Breaks', url: osbUrl, bpm: 92.04, offset: 0.164 },
  { name: 'Degraded Digital Haze', url: ddhUrl, bpm: 90.10, offset: -0.18 },
  { name: 'Outer Space Breaks II', url: osb2Url, bpm: 91.11, offset: 0.179 },
];

// Procedural WebAudio: everything is synthesised (no assets).
// The soundtrack is a streamed track; its clock + a live analyser (beat.js) drive the visuals.
// Recorded one-shots (jump / land / slide / step) layer over synthesized detail.
// Wind rises with speed, footsteps lock to the head-bob, landings thump by impact,
// wallrun scrapes, a low detuned drone sits under it all.

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.trackIdx = 0;
  }

  /** the sector's own track: switched (crossfaded) at once if the music is already running */
  setSector(sector) {
    const i = (Math.max(1, sector) - 1) % TRACKS.length;
    if (i === this.trackIdx && this.el) return;
    this.trackIdx = i;
    if (this.music) this.playTrack(i);
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = 0.7;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);

    // shared white noise buffer
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;

    // wind: looping noise → bandpass, gain by speed
    this.wind = this.loopNoise('bandpass', 600, 0.6);
    this.wind2 = this.loopNoise('highpass', 3000, 0.0);
    // contact loops (wallrun scrape, slide hiss)
    this.scrape = this.loopNoise('bandpass', 2400, 0.0, 6);
    this.hiss = this.loopNoise('lowpass', 900, 0.0);

    // drone
    this.drone = c.createGain();
    this.drone.gain.value = 0.0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.Q.value = 4;
    this.droneLP = lp;
    this.droneOsc = [55, 55.37, 82.6, 110.2].map((f, i) => {
      const o = c.createOscillator();
      o.type = i < 2 ? 'sawtooth' : 'triangle';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = i < 2 ? 0.25 : 0.12;
      o.connect(g).connect(lp);
      o.start();
      return o;
    });
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = c.createGain();
    lfoG.gain.value = 160;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();
    lp.connect(this.drone).connect(this.master);
    this.drone.gain.setTargetAtTime(0.012, c.currentTime, 2);
    this.startMusic();
  }

  // ------------------------------------------------------------------ music (the track) + samples
  startMusic() {
    const c = this.ctx;
    this.music = c.createGain();
    this.music.gain.value = 0.75;
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.5;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.music.connect(this.analyser);
    this.music.connect(this.master);
    this.playTrack(this.trackIdx);
    this.lowPrev = 0;
    // one-shot samples
    this.samples = {};
    for (const [k, url] of Object.entries(SFX)) {
      fetch(url).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).then((buf) => { this.samples[k] = buf; }).catch(() => {});
    }
  }

  /** start TRACKS[i] (the one playing fades out under it); the beat clock follows the new one */
  playTrack(i) {
    const c = this.ctx;
    const T = TRACKS[i];
    const t = c.currentTime;
    if (this.cur) {
      const old = this.cur;
      old.g.gain.setTargetAtTime(0, t, 0.35);
      old.el.onended = null;
      setTimeout(() => { old.el.pause(); old.src.disconnect(); }, 2000);
    }
    const el = new window.Audio(T.url);
    el.crossOrigin = 'anonymous';
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setTargetAtTime(1, t, 0.25);
    const src = c.createMediaElementSource(el);
    src.connect(g).connect(this.music);
    el.onended = () => { if (this.cur?.el === el) { this.trackIdx = (i + 1) % TRACKS.length; this.playTrack(this.trackIdx); } };
    el.play().catch(() => {});
    this.el = el;
    this.cur = { el, g, src };
    setTempo(T.bpm);
    beat.source = () => el.currentTime - T.offset;
  }

  /** play a sample with a little pitch/volume variation; returns false if not loaded yet */
  sample(name, { gain = 0.6, rate = 1, vary = 0.06, delay = 0 } = {}) {
    const buf = this.samples?.[name];
    if (!buf) return false;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * vary);
    const g = c.createGain();
    g.gain.value = gain * (1 + (Math.random() * 2 - 1) * vary);
    src.connect(g).connect(this.master);
    src.start(c.currentTime + delay);
    if (name === 'slide') this.slideSrc = { src, g };
    return true;
  }

  /** live analysis of the track: low-band level + onset (kick) for the visuals */
  analyse() {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.freq);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const lo = Math.max(1, Math.round(140 / binHz));
    let low = 0;
    for (let i = 1; i <= lo; i++) low += this.freq[i];
    low /= lo * 255;
    let mid = 0;
    const m0 = Math.round(400 / binHz);
    const m1 = Math.round(3000 / binHz);
    for (let i = m0; i < m1; i++) mid += this.freq[i];
    mid /= (m1 - m0) * 255;
    const flux = Math.max(0, low - this.lowPrev);
    this.lowPrev = low * 0.85 + this.lowPrev * 0.15;
    beat.live = { low, mid, onset: Math.min(1, flux * 7) };
  }

  loopNoise(type, freq, gain, Q = 0.8) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { f, g };
  }

  setTheme(rootHz) {
    this.root = rootHz;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const ratios = [1, 1.0067, 1.5, 2.004];
    this.droneOsc.forEach((o, i) => o.frequency.setTargetAtTime(rootHz * ratios[i], t, 1.5));
  }

  /** continuous layers, once per frame */
  update(r, racing) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = racing ? r.speed + Math.max(0, -r.vy) * 0.6 : 0;
    const k = Math.min(1, Math.max(0, (sp - 3) / 14));
    this.wind.g.gain.setTargetAtTime(0.05 + k * k * 0.5, t, 0.08);
    this.wind.f.frequency.setTargetAtTime(350 + k * 1600, t, 0.1);
    this.wind2.g.gain.setTargetAtTime(k * k * 0.08, t, 0.1);
    this.scrape.g.gain.setTargetAtTime(racing && r.mode === 'wall' ? 0.16 : 0, t, 0.03);
    this.hiss.g.gain.setTargetAtTime(racing && r.mode === 'slide' ? 0.07 : 0, t, 0.04);
    this.droneLP.Q.value = 4 + r.flow * 6;
    // the track ducks under heavy impacts / opens up with flow
    if (this.music) this.music.gain.setTargetAtTime(racing ? 0.62 + r.flow * 0.13 : 0.75, t, 0.3);
    this.analyse();
  }

  // ---- one-shots
  burst({ freq = 1200, type = 'bandpass', Q = 1, dur = 0.06, gain = 0.3, sweep = 0, delay = 0 }) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    f.Q.value = Q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tone({ freq = 440, type = 'sine', dur = 0.15, gain = 0.2, slide = 0, delay = 0, attack = 0.004 }) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  footstep(foot, speed, onWall) {
    const k = Math.min(1, speed / 10);
    if (this.sample('step', { gain: 0.25 + k * 0.3, rate: onWall ? 1.25 : 1 + foot * 0.03, vary: 0.08 })) return;
    this.burst({ freq: (onWall ? 2600 : 1700) + foot * 150, Q: 1.2, dur: 0.045, gain: 0.08 + k * 0.1 });
    this.tone({ freq: onWall ? 140 : 95 + foot * 6, dur: 0.07, gain: 0.12 + k * 0.08, slide: 0.6 });
  }

  event(e) {
    if (!this.ctx) return;
    switch (e.type) {
      case 'jump':
        if (this.sample('jump', { gain: 0.55 })) break;
        this.burst({ freq: 500, type: 'lowpass', dur: 0.18, gain: 0.12, sweep: 4 });
        this.tone({ freq: 120, dur: 0.08, gain: 0.12, slide: 0.7 });
        break;
      case 'land': {
        const k = Math.min(1, e.impact / 14);
        if (this.sample('land', { gain: 0.2 + k * 0.6, rate: 1.1 - k * 0.2 })) {
          if (k > 0.8) this.tone({ freq: 55, dur: 0.3, gain: 0.35, slide: 0.45 });
          break;
        }
        this.tone({ freq: 70, dur: 0.16, gain: 0.15 + k * 0.3, slide: 0.5 });
        this.burst({ freq: 900, Q: 0.7, dur: 0.09, gain: 0.08 + k * 0.15 });
        break;
      }
      case 'hardland':
        this.sample('land', { gain: 1, rate: 0.75, vary: 0 });
        this.tone({ freq: 55, dur: 0.35, gain: 0.6, slide: 0.4 });
        this.burst({ freq: 400, type: 'lowpass', dur: 0.3, gain: 0.4 });
        this.tone({ freq: 523, type: 'square', dur: 0.12, gain: 0.04, delay: 0.02, slide: 0.5 });
        break;
      case 'roll':
        this.sample('land', { gain: 0.6, rate: 0.85 });
        this.sample('slide', { gain: 0.35, rate: 1.3, delay: 0.05 });
        this.tone({ freq: 80, dur: 0.18, gain: 0.3, slide: 0.6 });
        this.burst({ freq: 700, type: 'bandpass', Q: 0.6, dur: 0.4, gain: 0.15, sweep: 0.4 });
        break;
      case 'wallrun':
        this.tone({ freq: 180, dur: 0.1, gain: 0.18, slide: 0.7 });
        this.burst({ freq: 3000, Q: 3, dur: 0.12, gain: 0.12 });
        break;
      case 'walljump':
        this.sample('jump', { gain: 0.45, rate: 1.15 });
        this.tone({ freq: 1240, type: 'triangle', dur: 0.25, gain: 0.07 });
        this.tone({ freq: 1860, type: 'sine', dur: 0.3, gain: 0.05, delay: 0.03 });
        this.burst({ freq: 700, type: 'lowpass', dur: 0.22, gain: 0.15, sweep: 5 });
        break;
      case 'vault':
      case 'mantle':
        this.sample('step', { gain: 0.5, rate: 0.8 });
        this.tone({ freq: 140, dur: 0.1, gain: 0.2, slide: 0.6 });
        this.burst({ freq: 1400, Q: 1, dur: 0.12, gain: 0.12 });
        break;
      case 'climb':
        this.burst({ freq: 2200, Q: 2, dur: 0.1, gain: 0.1 });
        break;
      case 'slide':
        if (this.sample('slide', { gain: 0.55 })) break;
        this.burst({ freq: 1800, type: 'highpass', dur: 0.25, gain: 0.12, sweep: 0.5 });
        break;
      case 'hookfire':
        // the line paying out: a descending zip
        this.tone({ freq: 2400, type: 'sawtooth', dur: 0.22, gain: 0.035, slide: 0.25 });
        this.tone({ freq: 160, dur: 0.08, gain: 0.18, slide: 0.6 });
        break;
      case 'hookmiss':
        this.tone({ freq: 220, type: 'square', dur: 0.07, gain: 0.04, slide: 0.8 });
        break;
      case 'hookattach':
        // the recorded bite; pivot posts bite a little higher and brighter than swing nodes
        if (this.sample('hook', { gain: 0.42, rate: e.pivot ? 1.12 : 1, vary: 0.04 })) break;
        this.tone({ freq: 1760, type: 'square', dur: 0.05, gain: 0.05 });
        this.tone({ freq: 98, dur: 0.18, gain: 0.25, slide: 0.55 });
        break;
      case 'ropesnap':
        this.tone({ freq: 62, dur: 0.22, gain: 0.25 + e.k * 0.25, slide: 0.5 });
        break;
      case 'hookrelease':
        this.tone({ freq: 880, type: 'triangle', dur: 0.1, gain: 0.04, slide: 1.6 });
        break;
      case 'tuck':
        this.tone({ freq: 210, dur: 0.06, gain: 0.08, slide: 0.7 });
        break;
      case 'bonk':
        this.tone({ freq: 90, dur: 0.25, gain: 0.5, slide: 0.5 });
        this.tone({ freq: 740, type: 'square', dur: 0.08, gain: 0.05 });
        break;
      case 'fall':
        for (let i = 0; i < 6; i++) this.tone({ freq: 200 + Math.random() * 1800, type: 'square', dur: 0.05, gain: 0.05, delay: i * 0.04 });
        break;
      case 'clean':
        this.tone({ freq: 1318, type: 'sine', dur: 0.12, gain: 0.05 });
        this.tone({ freq: 1975, type: 'sine', dur: 0.14, gain: 0.04, delay: 0.05 });
        break;
      case 'flowmax':
        [880, 1108, 1318, 1760].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.5, gain: 0.05, delay: i * 0.05 }));
        break;
      case 'count':
        this.tone({ freq: e.go ? 1318 : 659, type: 'square', dur: e.go ? 0.4 : 0.12, gain: 0.06 });
        break;
      case 'finish':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 1.2, gain: 0.06, delay: i * 0.07 }));
        break;
    }
  }
}
