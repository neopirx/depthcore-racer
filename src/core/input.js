// Keyboard + mouse (pointer lock) + gamepad. "Pressed" edges are consumed once per rendered frame.
const JUMP = ['Space'];
const SLIDE = ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'KeyC'];
const FWD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA'];
const RIGHT = ['KeyD'];
const TURN_L = ['ArrowLeft'];
const TURN_R = ['ArrowRight'];
const GRAPPLE = ['KeyF', 'Mouse0'];
const BLOCK = new Set([...JUMP, ...SLIDE, ...FWD, ...BACK, ...LEFT, ...RIGHT, ...TURN_L, ...TURN_R, 'KeyF', 'Tab']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.padPrev = [];
    this.lookX = 0;
    this.lookY = 0;
    this.locked = false;
    this.sens = 1;
    try { this.sens = +(localStorage.getItem('depthcore.sens') || 1) || 1; } catch { /* no storage */ }

    addEventListener('keydown', (e) => {
      if (e.target?.closest('input, textarea, select, button')) return;
      if (BLOCK.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // ignore the occasional giant spike some browsers emit on lock
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.pressed.add('Mouse0');
      if (e.button === 2) this.pressed.add('Mouse2');
      this.down.add('Mouse' + e.button);
    });
    addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
  }

  lock() {
    if (this.locked || !this.canvas.requestPointerLock) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p?.catch) p.catch(() => this.canvas.requestPointerLock());
    } catch {
      this.canvas.requestPointerLock();
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setSens(v) {
    this.sens = Math.min(4, Math.max(0.2, v));
    try { localStorage.setItem('depthcore.sens', String(this.sens)); } catch { /* no storage */ }
  }

  isDown(codes) {
    return codes.some((c) => this.down.has(c));
  }

  wasPressed(codes) {
    if (typeof codes === 'string') codes = [codes];
    return codes.some((c) => this.pressed.has(c));
  }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && [...pads].find((p) => p);
    this.pad = null;
    if (!pad) return;
    const b = pad.buttons.map((x) => x.pressed);
    const edge = (i) => b[i] && !this.padPrev[i];
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    this.pad = {
      mx: dz(pad.axes[0]),
      my: dz(pad.axes[1]),
      lx: dz(pad.axes[2] ?? 0),
      ly: dz(pad.axes[3] ?? 0),
      jump: edge(0) || edge(4),
      jumpHeld: b[0] || b[4],
      slide: edge(1) || edge(7) || edge(5),
      slideHeld: b[1] || b[7] || b[5],
      start: edge(9) || edge(0),
      back: edge(8) || edge(9) || edge(1),
      grapple: edge(2) || edge(6),
      grappleHeld: b[2] || b[6],
      pick: [edge(2), edge(3), edge(1)],
    };
    this.padPrev = b;
  }

  /** Mouse/stick look delta in radians since last call. */
  consumeLook(dt) {
    const k = 0.0022 * this.sens;
    let yaw = -this.lookX * k;
    let pitch = -this.lookY * k;
    this.lookX = 0;
    this.lookY = 0;
    const kt = (this.isDown(TURN_R) ? 1 : 0) - (this.isDown(TURN_L) ? 1 : 0);
    yaw -= kt * 2.6 * dt;
    if (this.pad) {
      // stick look with a curve: precise near the centre, fast at the rim
      const c = (v) => Math.sign(v) * v * v;
      yaw -= c(this.pad.lx) * 3.6 * this.sens * dt;
      pitch -= c(this.pad.ly) * 2.4 * this.sens * dt;
    }
    return { yaw, pitch };
  }

  racer() {
    let fwd = (this.isDown(FWD) ? 1 : 0) - (this.isDown(BACK) ? 1 : 0);
    let side = (this.isDown(RIGHT) ? 1 : 0) - (this.isDown(LEFT) ? 1 : 0);
    let jump = this.wasPressed(JUMP);
    let jumpHeld = this.isDown(JUMP);
    let slide = this.wasPressed(SLIDE) || this.wasPressed('Mouse2');
    let slideHeld = this.isDown(SLIDE) || this.isDown(['Mouse2']);
    let grapple = this.wasPressed(GRAPPLE);
    let grappleHeld = this.isDown(GRAPPLE);
    if (this.pad) {
      if (Math.abs(this.pad.my) > Math.abs(fwd)) fwd = -this.pad.my;
      if (Math.abs(this.pad.mx) > Math.abs(side)) side = this.pad.mx;
      jump ||= this.pad.jump;
      jumpHeld ||= this.pad.jumpHeld;
      slide ||= this.pad.slide;
      slideHeld ||= this.pad.slideHeld;
      grapple ||= this.pad.grapple;
      grappleHeld ||= this.pad.grappleHeld;
    }
    return { fwd, side, jump, jumpHeld, slide, slideHeld, grapple, grappleHeld };
  }

  confirm() {
    return this.wasPressed(['Enter', 'NumpadEnter']) || !!this.pad?.start;
  }

  back() {
    return this.wasPressed('Escape') || !!this.pad?.back;
  }

  endFrame() {
    this.pressed.clear();
  }
}
