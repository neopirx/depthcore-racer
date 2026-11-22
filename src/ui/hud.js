import './hud.css';

const fmtTime = (t) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};
/** clock split so the centiseconds can sit smaller/dimmer than mm:ss */
const fmtClock = (t) => {
  const s = fmtTime(t);
  return [s.slice(0, 5), s.slice(5)];
};
const hex = (n) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
const STAMP = { SWING: 'SWING', WHIP: 'WHIP', RUN: 'RUN', AIR: 'AIR', SLIDE: 'SLIDE', WALL: 'WALLRUN', CLIMB: 'CLIMB', VAULT: 'VAULT', ROLL: 'ROLL', IMPACT: 'IMPACT', RESYNC: 'RESYNC', CORE: 'CORE' };
const BAR_N = 24;
const BAR_MAX = 50;   // km/h at the end of the bar graph
const SEVEN = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@<>/\\=+*';

/** cipher decode: characters resolve left to right out of random glyphs */
function scramble(el, text, dur = 0.25) {
  const t0 = performance.now();
  clearInterval(el._scr);
  const tick = () => {
    const k = Math.min(1, (performance.now() - t0) / (dur * 1000));
    const n = Math.floor(k * text.length);
    let out = text.slice(0, n);
    for (let i = n; i < text.length; i++) out += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    el.textContent = out;
    if (k >= 1) clearInterval(el._scr);
  };
  tick();
  el._scr = setInterval(tick, 30);
}

export class Hud {
  constructor(root) {
    root.innerHTML = /* html */ `
      <div class="layer interactive" id="title">
        <div class="top lbl"><span>DCR-01 // BUILD 0.4</span><span class="t-seed"></span><span class="sp"></span><span>LINK :: SECURE</span></div>
        <div class="main">
          <div class="wm">DEPTH<br><span class="o">CORE</span></div>
          <div class="sub"><span class="blk">RACER</span><span class="tag">six courses. one fastest line.</span></div>
          <div class="info">
            <div><span class="lbl">sector</span><b class="t-sector">01</b></div>
            <div><span class="lbl">zone</span><b class="t-zone">—</b></div>
            <div><span class="lbl">depth</span><b class="t-len">—</b></div>
            <div><span class="lbl">mode</span><b>TIME TRIAL</b></div>
          </div>
          <div class="identity-panel">
            <div class="identity-ready" hidden>RUNNER // <b class="runner-name"></b> <button type="button" class="change-name">Change name</button></div>
            <form class="name-form">
              <label for="runner-name">ENTER YOUR RUNNER NAME</label>
              <div class="name-row"><input id="runner-name" name="runner" autocomplete="nickname" minlength="2" maxlength="20" required placeholder="Your name" aria-describedby="name-help"><button type="submit">JOIN</button></div>
              <p id="name-help" class="prose">2–20 characters. Your name appears on the shared leaderboards.</p>
              <p class="name-error prose" role="status"></p>
              <button type="button" class="practice-name">Practice without connecting</button>
            </form>
          </div>
          <div class="level-picker" aria-label="Choose a level"></div>
          <button type="button" class="go"><span class="k">ENTER</span><span class="t">RACE LEVEL</span></button>
        </div>
        <div class="ctl">
          <span class="k"><i class="key">W</i><i class="key">A</i><i class="key">S</i><i class="key">D</i></span><span class="d prose">Run · strafe</span>
          <span class="k"><i class="key">SPACE</i></span><span class="d prose">Jump · vault · climb · <b>wallrun</b> along walls · <b>kick</b> off them</span>
          <span class="k"><i class="key">SHIFT</i></span><span class="d prose">Slide · <b>roll</b> just before a big landing</span>
          <span class="k"><i class="key">LMB</i></span><span class="d prose"><b>Grapple</b> — fire early, hold to swing · posts: hold to whip round, let go to fly off</span>
          <div class="hints"><span><i class="key sm">[ ]</i>sens <b class="t-sens"></b></span><span><i class="key sm">M</i>calm cam <b class="t-calm"></b></span><span><i class="key sm">1–6</i>choose level</span></div>
        </div>
        <section class="title-board box"><div class="board-heading">LEVEL LEADERBOARD</div><p class="ghost-summary prose"></p><div class="board-list title-board-list" aria-live="polite"></div></section>
        <div class="side">depthcore.sys — routing — node 0x3F — do not look down</div>
        <div class="bracket tl"></div><div class="bracket tr"></div><div class="bracket bl"></div><div class="bracket br"></div>
      </div>

      <div class="layer" id="race">
        <div class="tl">
          <div class="name">DEPTHCORE<span class="acid">//</span>RACER</div>
          <div class="row"><span class="blk r-sector">SEC 01</span><span class="r-zone"></span></div>
        </div>
        <div class="tc">
          <div class="lbl">route to core</div>
          <div class="prog">
            <div class="ticks"></div><div class="rail"></div><div class="fill r-fill"></div><div class="core"></div>
            <div class="mark r"></div><div class="mark p"></div>
          </div>
          <div class="meta"><span class="r-dist">0000 M</span><span class="lbl"><i class="key-p"></i>you<i class="key-r"></i>ghost</span></div>
        </div>
        <div class="tr">
          <div class="lbl">elapsed</div>
          <div class="time"><span class="r-time">00:00</span><small class="r-cs">.00</small></div>
          <div class="stand r-stand"><span class="pos r-pos">1ST</span><span class="blk r-delta">+0.0 M</span></div>
        </div>
        <div class="bl">
          <div class="kicks ctx r-kicks"><span class="lbl">kicks</span><i></i><i></i><i></i></div>
          <div class="chainrow"><span class="chain r-chain">00</span><span class="lbl">chain</span></div>
          <div class="flowrow"><span class="lbl">flow</span><div class="cells flow r-flow"></div></div>
        </div>
        <div class="bc">
          <div class="speed r-speedbox"><span class="seg7 r-speed"></span><span class="lbl u">km/h</span></div>
          <div class="cells bar r-bar"></div>
          <div class="stamp r-stamp">RUN</div>
        </div>
        <div class="br">
          <div class="ab r-hookab"><svg viewBox="0 0 24 24"><path d="M4 20 15 9" stroke="currentColor" stroke-width="2"/><path d="M15 4 20 9 15 14 10 9Z" fill="none" stroke="currentColor" stroke-width="2"/></svg><span class="n">HOOK</span><i class="key sm">LMB</i></div>
          <div class="ab on r-slideab"><svg viewBox="0 0 24 24"><path d="M3 17h13l5-5M3 13h9" fill="none" stroke="currentColor" stroke-width="2"/></svg><span class="n">SLIDE</span><i class="key sm">SHIFT</i></div>
          <div class="barcode"></div>
        </div>
        <div id="hook"><i class="c a"></i><i class="c b"></i><i class="c c"></i><i class="c d"></i><b class="dm"></b><span class="t"></span></div>
        <div class="reticle"></div><div class="dot"></div>
        <div id="pops"></div>
        <div id="rivaltag">RIVAL</div>
      </div>

      <div class="layer" id="count"><div class="n">3</div><div class="sub">sync with record ghost</div></div>

      <div class="layer interactive" id="results">
        <div class="banner"><div class="big res-title">CORE BREACHED</div><div class="id"><span class="res-sector"></span><span class="res-seed"></span></div></div>
        <div class="side box">
          <div class="h">RUN SUMMARY</div>
          <div class="stats">
            <div class="hi"><span>your time</span><b class="res-you"></b></div>
            <div><span>record ghost</span><b class="res-rival"></b></div>
            <div><span>margin</span><b class="res-margin"></b></div>
            <div><span>clean moves</span><b class="res-clean"></b></div>
            <div><span>impacts</span><b class="res-imp"></b></div>
            <div><span>falls</span><b class="res-falls"></b></div>
          </div>
        </div>
        <section class="results-board box"><div class="board-heading">LEVEL LEADERBOARD</div><div class="board-list results-board-list" aria-live="polite"></div></section>
        <div class="result-actions"><p class="submit-status prose" role="status"></p><button type="button" class="submit-retry" hidden>Retry submission</button>
          <div class="result-buttons"><button type="button" class="res-replay">ENTER // RACE AGAIN</button><button type="button" class="res-next">N // NEXT LEVEL</button><button type="button" class="res-levels">ESC // LEVEL SELECT</button></div>
        </div>
      </div>

      <div class="layer interactive" id="pause">
        <div class="box">
          <div class="big">PAUSED</div>
          <div class="opt sel"><span>RESUME</span><i class="key">ENTER</i></div>
          <div class="opt"><span>RESTART SECTOR</span><i class="key">R</i></div>
          <div class="opt"><span>QUIT TO TITLE</span><i class="key">Q</i></div>
          <div class="hints"><span><i class="key sm">[ ]</i>sens <b class="t-sens"></b></span><span><i class="key sm">M</i>calm cam <b class="t-calm"></b></span></div>
        </div>
      </div>
      <div class="layer" id="lockhint"><div class="lbl">click to capture mouse</div></div>
    `;
    this.root = root;
    const $ = (s) => root.querySelector(s);
    this.$ = $;
    this.layers = {
      title: $('#title'), race: $('#race'), count: $('#count'), results: $('#results'), pause: $('#pause'), lockhint: $('#lockhint'),
    };
    this.el = {
      time: $('.r-time'), cs: $('.r-cs'), delta: $('.r-delta'), dist: $('.r-dist'), fill: $('.r-fill'),
      markP: $('.mark.p'), markR: $('.mark.r'), flow: $('.r-flow'), pos: $('.r-pos'),
      stamp: $('.r-stamp'), kicksBox: $('.r-kicks'), kicks: [...root.querySelectorAll('.r-kicks i')],
      pops: $('#pops'), rivalTag: $('#rivaltag'),
      chain: $('.r-chain'), bar: $('.r-bar'), speed: $('.r-speed'), speedBox: $('.r-speedbox'), stand: $('.r-stand'),
      hook: $('#hook'), hookT: $('#hook .t'), hookAb: $('.r-hookab'), slideAb: $('.r-slideab'),
    };
    this.el.flow.innerHTML = '<i></i>'.repeat(5);
    this.el.bar.innerHTML = '<i></i>'.repeat(BAR_N);
    this.barEls = [...this.el.bar.children];
    this.shownKmh = -1;
    // car-style 7-segment readout: unlit segments stay faintly visible, like an LCD
    this.digitEls = [];
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div');
      d.className = 'dg';
      d.innerHTML = 'abcdefg'.split('').map((k) => `<i class="${k}"></i>`).join('');
      this.el.speed.appendChild(d);
      this.digitEls.push({ d, segs: [...d.children] });
    }
    this.flowEls = [...this.el.flow.children];
    this.pal = { acid: '#dcff1e', paper: '#f2f5f7', ink: '#050607', rival: '#ff2d55', player: '#bff3ff' };
    this.vs = 0;
    this.chainBase = 0;
    this.chainBad = 0;
    this.chainShown = 0;
    this.lastT = 0;
    this.lastState = '';
    $('.name-form').addEventListener('submit', (event) => { event.preventDefault(); this.onName?.($('#runner-name').value); });
    $('.practice-name').addEventListener('click', () => this.onName?.($('#runner-name').value, true));
    $('.change-name').addEventListener('click', () => this.onChangeName?.());
  }

  show(name) {
    for (const [k, v] of Object.entries(this.layers)) {
      if (k === 'lockhint') continue;
      v.classList.toggle('on', k === name || (name === 'pause' && k === 'race'));
    }
  }

  lockHint(on) {
    this.layers.lockhint.classList.toggle('on', on);
  }

  /** Pull the whole HUD palette from the level's theme so UI and world read as one. */
  setTheme(theme) {
    const h = theme.hud;
    if (!h) return;
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
    const st = document.documentElement.style;
    st.setProperty('--acid', h.accent);
    st.setProperty('--accent-rgb', rgb(h.accent));
    st.setProperty('--ink', h.ink);
    st.setProperty('--shade-rgb', rgb(h.ink));
    st.setProperty('--white', h.paper);
    st.setProperty('--paper-rgb', rgb(h.paper));
    st.setProperty('--dim', `rgba(${rgb(h.paper)}, 0.6)`);
    st.setProperty('--faint', `rgba(${rgb(h.paper)}, 0.18)`);
    st.setProperty('--ahead', h.ahead ?? h.accent);
    Object.assign(this.pal, { acid: h.accent, paper: h.paper, ink: h.ink, ahead: h.ahead ?? h.accent });
  }

  /** grapple lock-on bracket: screen pos (or null), { d, state: ready|flying|locked|swing, k } */
  anchor(screen, info) {
    const h = this.el.hook;
    this.el.hookAb.className = `ab r-hookab ${screen ? (info.state === 'ready' ? 'on' : 'live') : ''}`;
    if (!screen) { h.style.display = 'none'; return; }
    h.style.display = 'block';
    const sz = info.state === 'ready' ? 40 : info.state === 'flying' ? 40 - 16 * info.k : 24;
    h.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -50%)`;
    h.style.width = h.style.height = `${sz}px`;
    h.className = info.state + (info.pivot ? ' piv' : '');
    const t = info.state === 'ready' ? `${info.pivot ? 'PIVOT ' : ''}${Math.round(info.d)} M` : info.state === 'flying' ? 'HOOK' : info.state === 'swing' ? (info.pivot ? 'WHIP' : 'SWING') : 'LOCKED';
    if (h._t !== t) { h._t = t; this.el.hookT.textContent = t; }
  }

  settings({ sens, calm }) {
    this.root.querySelectorAll('.t-sens').forEach((e) => { e.textContent = `${sens.toFixed(1)}×`; });
    this.root.querySelectorAll('.t-calm').forEach((e) => { e.textContent = calm ? 'ON' : 'OFF'; });
  }

  setInfo({ sector, theme, seed, length, courseName, custom }) {
    const $ = this.$;
    this.setTheme(theme);
    const sec = String(sector).padStart(2, '0');
    $('.t-sector').textContent = sec;
    $('.t-zone').textContent = theme.label;
    $('.t-len').textContent = `${Math.round(length)} M`;
    $('.t-seed').textContent = `SEED ${hex(seed)}`;
    $('.t-zone').textContent = courseName;
    $('.r-sector').textContent = `LEVEL ${sec}/06`;
    $('.r-zone').textContent = theme.label;
    if (custom) {
      $('.t-sector').textContent = 'EDIT';
      $('.t-seed').textContent = `CUSTOM // ${custom}`;
      $('.r-sector').textContent = 'EDIT';
      $('.r-zone').textContent = custom;
    }
  }

  countdown(n) {
    const el = this.$('#count .n');
    el.textContent = n > 0 ? n : 'RUN';
    el.classList.toggle('go', n <= 0);
  }

  update({ player, rival, track, raceTime }) {
    const el = this.el;
    if (raceTime < this.lastT || raceTime < 0.05) { this.chainBase = player.cleans; this.chainBad = player.stumbles + player.falls; }
    this.lastT = raceTime;
    const [mmss, cs] = fmtClock(raceTime);
    el.time.textContent = mmss;
    el.cs.textContent = cs;

    // ---- 7-segment km/h (leading zeros dimmed) + LED bar with the overspeed band
    const kmh = Math.min(999, Math.round(player.speed * 3.6));
    const cap = player.stats.maxSpeed ?? 8.6;
    const hot = player.speed > cap + 0.05;
    if (kmh !== this.shownKmh) {
      this.shownKmh = kmh;
      const str = String(kmh).padStart(3, '0');
      const lead = 3 - String(kmh).length;
      this.digitEls.forEach((D, i) => {
        const on = SEVEN[str[i]];
        D.d.classList.toggle('lz', i < lead);
        D.segs.forEach((sg, k) => sg.classList.toggle('on', on.includes('abcdefg'[k])));
      });
    }
    el.speedBox.classList.toggle('hot', hot);
    this.vs += (player.speed * 3.6 - this.vs) * 0.35;
    const lit = Math.round((Math.min(BAR_MAX, this.vs) / BAR_MAX) * BAR_N);
    const capI = Math.floor(((cap * 3.6) / BAR_MAX) * BAR_N);
    if (lit !== this.litShown || capI !== this.capShownI) {
      this.litShown = lit;
      this.capShownI = capI;
      this.barEls.forEach((c, i) => { c.className = `${i < lit ? 'on' : ''}${i >= capI ? ' over' : ''}`; });
    }

    // ---- flow / chain / kicks
    const fl = Math.round(player.flow * 5);
    this.flowEls.forEach((c, i) => c.classList.toggle('on', i < fl));
    el.flow.classList.toggle('max', player.flow >= 1);
    const left = player.grounded ? 3 : Math.max(0, (player.stats.maxKicks ?? 3) - player.kicks);
    el.kicks.forEach((k, i) => k.classList.toggle('on', i < left));
    el.kicksBox.classList.toggle('show', !player.grounded);
    el.slideAb.classList.toggle('live', player.mode === 'slide' || player.mode === 'roll');
    const bad = player.stumbles + player.falls;
    if (bad !== this.chainBad) { this.chainBad = bad; this.chainBase = player.cleans; }
    const chain = player.cleans - this.chainBase;
    if (chain !== this.chainShown) {
      el.chain.classList.remove('bump', 'broke');
      void el.chain.offsetWidth;   // restart the animation
      el.chain.classList.add(chain > this.chainShown ? 'bump' : 'broke');
      this.chainShown = chain;
      el.chain.textContent = String(chain).padStart(2, '0');
    }
    el.chain.classList.toggle('hot', chain >= 8);

    // ---- route
    const total = track.finishS;
    const pp = Math.min(1, Math.max(0, player.s / total));
    const rp = Math.min(1, Math.max(0, rival.s / total));
    el.markP.style.left = `calc(${pp} * (100% - 18px))`;
    el.markR.hidden = !this.hasGhost;
    el.markR.style.left = `calc(${rp} * (100% - 18px))`;
    el.fill.style.width = `calc(${pp} * (100% - 18px))`;
    el.dist.textContent = `${String(Math.max(0, Math.round(total - player.s))).padStart(4, '0')} M TO CORE`;

    const d = player.s - rival.s;
    const cls = d >= 0 ? 'ahead' : 'behind';
    el.delta.className = `blk r-delta ${cls}`;
    el.delta.textContent = `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} M`;
    el.stand.className = `stand r-stand ${cls}`;
    el.pos.textContent = this.hasGhost ? (d >= 0 ? 'AHEAD' : 'BEHIND') : 'SOLO';
    if (!this.hasGhost) { el.delta.textContent = 'SET A TIME'; el.stand.className = 'stand r-stand'; }

    const st = player.state;
    if (st !== this.lastState) {
      this.lastState = st;
      el.stamp.className = `stamp r-stamp ${st === 'IMPACT' || st === 'RESYNC' ? 'bad' : st === 'AIR' ? 'air' : st === 'RUN' ? '' : 'acid'}`;
      scramble(el.stamp, STAMP[st] ?? st, 0.18);
    }
  }

  /** beat pulse for CSS (0..1) */
  beat(k) {
    this.root.style.setProperty('--kick', k.toFixed(3));
  }

  /** screen: {x, y, edge} in px; edge = the rival is off-screen and the tag is clamped to the border */
  rivalTag(screen, dist) {
    const t = this.el.rivalTag;
    if (!screen) {
      t.style.display = 'none';
      return;
    }
    t.style.display = 'block';
    t.classList.toggle('edge', !!screen.edge);
    t.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -100%)`;
    const pre = screen.edge === 'l' ? '◂ ' : screen.edge && screen.edge !== 'r' ? '▾ ' : '';
    const post = screen.edge === 'r' ? ' ▸' : '';
    t.textContent = `${pre}GHOST ${dist >= 0 ? '+' : '−'}${Math.abs(dist).toFixed(0)}M${post}`;
  }

  pop(text, kind = '') {
    const p = document.createElement('div');
    p.className = `pop ${kind}`;
    scramble(p, text, 0.22);
    this.el.pops.appendChild(p);
    while (this.el.pops.children.length > 3) this.el.pops.firstChild.remove();
    setTimeout(() => p.remove(), 1150);
  }

  identity(name, draft = '') {
    this.$('.identity-ready').hidden = !name;
    this.$('.name-form').hidden = !!name;
    this.$('.runner-name').textContent = name;
    this.$('#runner-name').value = name || draft;
    this.$('.go').disabled = !name;
    this.nameError('');
  }

  focusName() { this.$('#runner-name').focus(); }
  nameError(message) { this.$('.name-error').textContent = message; }
  nameBusy(busy) { this.$('.name-form').querySelectorAll('button').forEach((button) => { button.disabled = busy; }); }

  levels(courses, selected, onSelect, custom) {
    const root = this.$('.level-picker');
    root.replaceChildren();
    for (const course of courses) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${String(course.number).padStart(2, '0')} / ${course.name}`;
      button.classList.toggle('selected', course.number === selected && !custom);
      button.setAttribute('aria-pressed', String(course.number === selected && !custom));
      button.disabled = custom;
      button.addEventListener('click', () => onSelect(course.number));
      root.append(button);
    }
  }

  ghostInfo(ghost, active) {
    this.hasGhost = active;
    this.$('.ghost-summary').textContent = ghost ? `Record ghost: ${ghost.name} // ${fmtTime(ghost.time)}` : 'No record yet. Be the first to set a time.';
    this.$('#count .sub').textContent = active ? 'race the fastest recorded run' : 'set your best time';
  }

  board(data, message = '') {
    for (const selector of ['.title-board-list', '.results-board-list']) {
      const root = this.$(selector);
      root.replaceChildren();
      if (!data || !data.entries.length) {
        const note = document.createElement('p');
        note.className = 'prose';
        note.textContent = message || 'No times yet. The first finish sets the record.';
        root.append(note);
        continue;
      }
      const table = document.createElement('table');
      table.innerHTML = '<thead><tr><th scope="col">#</th><th scope="col">RUNNER</th><th scope="col">TIME</th></tr></thead>';
      const body = document.createElement('tbody');
      for (const entry of data.entries) {
        const row = document.createElement('tr');
        row.classList.toggle('mine', entry.mine);
        for (const value of [entry.rank, entry.name, fmtTime(entry.time)]) {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.append(cell);
        }
        body.append(row);
      }
      table.append(body);
      root.append(table);
      if (data.personal) {
        const personal = document.createElement('p');
        personal.className = 'personal-best prose';
        personal.textContent = `Your best: ${fmtTime(data.personal.time)} // #${data.personal.rank}`;
        root.append(personal);
      }
    }
  }

  submission(message, retry) {
    this.$('.submit-status').textContent = message;
    const button = this.$('.submit-retry');
    button.hidden = !retry;
    button.onclick = retry || null;
  }

  results({ win, custom, player, rivalTime, sector, seed }) {
    const $ = this.$;
    this.layers.results.classList.remove('lose');
    $('.res-title').textContent = rivalTime === null ? 'RUN COMPLETE' : win ? 'RECORD BEATEN' : 'RUN COMPLETE';
    $('.res-sector').textContent = custom ? 'EDITOR PREVIEW' : `level ${String(sector).padStart(2, '0')} of 06`;
    $('.res-seed').textContent = `seed ${hex(seed)}`;
    $('.res-you').textContent = fmtTime(player.finishTime);
    $('.res-rival').textContent = rivalTime === null ? 'NO RECORD' : fmtTime(rivalTime);
    const margin = rivalTime === null ? null : player.finishTime - rivalTime;
    $('.res-margin').textContent = margin === null ? '—' : `${margin >= 0 ? '+' : '−'}${Math.abs(margin).toFixed(2)}S`;
    $('.res-clean').textContent = player.cleans;
    $('.res-imp').textContent = player.stumbles;
    $('.res-falls').textContent = player.falls;
    $('.res-next').textContent = custom ? 'BACK TO EDITOR' : sector === 6 ? 'N // LEVEL 01' : 'N // NEXT LEVEL';
    this.submission('');
  }
}
