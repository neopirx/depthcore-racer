# DEPTHCORE RACER

A first-person parkour time trial across six fixed courses in a Metalheart / Y2K chrome
megastructure. Players enter a runner name, compete on each course's shared leaderboard, and
race a ghost replay of the fastest recorded run. All runs use the same movement stats, with
no post-race upgrades. Before a course has a record, it is a solo time trial.

## Run locally

```sh
bun install --frozen-lockfile
bun run server      # game API + SQLite on http://localhost:3001
# In a second terminal:
bun run dev         # game on http://localhost:5173, API proxied to :3001
```

For a production build served locally:

```sh
bun run build       # public game in dist/, private editor in dist-admin/
bun run start       # serves both builds and the leaderboard API on :3001
bun run test        # fixed-course traversal, ghost replays, score API and geometry tests
```

The editor is available at `/admin/editor.html`. Set `ADMIN_USER` and `ADMIN_PASSWORD` in the
environment of the server (and Vite when developing), or in a local `.env`. Access is disabled
without both. Editor previews and debug autopilot runs never submit times. A static-only host
can run practice games, but shared boards and ghosts require the score server.

## Get the source

```sh
git clone https://github.com/neopirx/depthcore-racer.git
cd depthcore-racer
bun install --frozen-lockfile
```

The repository contains the game, source assets, level editor, score server and development
tools. Credentials, local SQLite data, dependencies and generated builds are excluded.

Additional development checks:

```sh
bun tools/sim.js          # generated courses: traversal and bot balance
bun tools/sim.js --alt    # alternate routes
bun tools/speedcheck.js   # speed checks and ramp slides
bun tools/overlap.js      # geometry clearance
bun tools/gauge.js        # walkway width transitions
```

## Map editor (`editor.html`, `src/editor/`)

A level is a list of **segments** (generator modules) plus free **shapes**:

```json
{ "name": "…", "seed": 123, "sector": 1, "diff": 0.5,
  "modules": [{ "type": "wallrun", "seed": 99, "style": "truss", "td": -1, "diff": 0.8 }],
  "shapes":  [{ "kind": "slab", "x": 0, "y": 4, "z": -40, "w": 4, "h": 1, "d": 4, "style": "tiered" }] }
```

`buildLevel(level)` (game/trackgen.js) replays it into exactly the course the game runs; every
generated track carries its own `track.level`, so a random course is just a starting point.
Each segment owns its seed, so rerolling / restyling / reordering one leaves the others' shapes intact.

- **Generate** from seed + difficulty (0..1) + length + zone, or load a campaign sector's preset.
- **Segments**: insert from the palette (after the selection), change type / style / turn side
  (honoured on north legs only) / per-segment difficulty, reroll its seed (`R`), move, duplicate,
  delete, **regen after** (keep up to here, randomise the rest), **play from here**.
- **Shapes**: slab / block / wall / pillar / pad anywhere; drag with the gizmo (0.25 m snap) or type
  values (`y` = top surface). Course dressing keeps clear of them; the bot's line ignores them.
- Every edit auto-validates with the perfect bot on the main line and every skill line (same check
  as `tools/sim.js`): faults are listed per segment and marked in red in the view.
- **Play** stores the level as `localStorage['depthcore.level.edit']` and opens `index.html?level=edit`
  (`&from=<metres>` starts at the nearest checkpoint). Export / import as `.dcr.json`.

## Controls

| Input | Action |
| --- | --- |
| Mouse | look / steer (click the game to capture the mouse) |
| W A S D | run / strafe — hold S in the air to shorten a jump |
| Space | jump · vault · climb (jump into a wall) |
| jump along a wall | wallrun; jump again to leap off toward where you look (chain wall to wall) |
| jump next to any wall (airborne) | UT-style wall kick — 3 per air chain, not off the same wall twice in a row |
| jump while climbing | kick off the climb toward where you look (90° / 180° turns) |
| Shift / C / RMB | slide · roll (press just before a big landing) · **coil** when pressed while rising in a jump (legs tuck: clears a lip 0.5 m higher) |
| LMB / F (hold) · pad X / LT | **grapple**: fires at the anchor node ahead (◇ lock-on bracket). The hook flies at 28 m/s, so fire on the run-up; hold to swing, release or jump to let go |
| [ / ] | mouse sensitivity |
| M | reduced camera motion (halves bob/tilt, no roll somersault, softer ASCII) |
| Esc | pause (Enter/click resume, R restart, Q title) |
| 1–6 (title) | choose a course |
| N (results) | next course |

Gamepad: left stick move, right stick look, A/LB jump, B/RB/RT slide.

## Debug URL params

- `?sector=3`: select one of the six fixed courses
- `?autopilot`: the player is driven by a perfect bot (good for watching / screenshots)
- `?autopilot&skip=13`: fast-forward the race N seconds
- `?freezeon=climb` / `?freezeat=8`: stop the sim when the player enters a mode / at race time (screenshots)
- `?rivalcam`: orbit camera around the rival (check its animation)
- `?level=edit`: race the map editor's level · `&from=120`: start at the checkpoint before 120 m
- `?calm`: reduced camera motion · `?lq`: no shadows, 1× pixel ratio · `?hq`: 2× pixel ratio, 4K shadow map

## How it fits together

```
src/
  main.js              state machine, mouse look, fixed-step sim + render interpolation, events → fx/audio
  core/rng.js          seeded RNG — same seed = identical course for both racers
  core/input.js        keyboard + pointer-lock mouse + gamepad
  game/constants.js    body sizes + BASE_STATS (all movement tuning lives here)
  game/world.js        collision world: AABB solids + ramps in an xz grid
  game/trackgen.js     course planner + segment validation + finalize (public API: generateTrack, buildLevel)
  game/gen/            the set-pieces: builder.js (cursor, routes, jump physics), common.js (shared helpers),
                       mod_basic / mod_walls / mod_grapple / mod_routes.js, catalog.js (weights + tags)
  game/kit.js          structure library: construction grid, lane gauge, size palette, structure styles, dressing, moving parts
  game/racer.js        first-person parkour body (run/slide/roll/air/wallrun/wall-kick/climb/mantle/vault),
                       shared by player AND bot → fair race
  game/bot.js          rival AI: racing line + annotated actions + air-braking onto small targets
  game/campaign.js     six fixed published courses and competition revision
  game/replay.js       recorded input playback and server verification
  game/avatar.js       fallback procedural rival body + light trail
  fp/camera.js         first-person camera rig (bob, landing springs, wall tilt/lean, mantle arc, kicks, roll, FOV)
  fx/beat.js           music clock (92.04 BPM track) + live analyser onsets → uBeat / uKick for every shader
  fx/materials.js      abstract "digital monolith" course material + runner-vision panels
  fx/post.js           bloom → god rays, speed blur/lines, chroma, grain, glitch, ASCII impact mode
  fx/audio.js          the music track, recorded SFX (jump/land/slide/step) + synthesized detail layers
  world/rival.js       rigged character driven by the UAL animation library via a runtime UAL→Mixamo retarget;
                       PlayerBody = the same rig in blue as your first-person body: legs on a slide
                       (Slide_Start/Loop/Exit, viewpoint offset FP_VIEW), hands everywhere else
                       (Sprint/Jog, ClimbUp_1m for mantle/climb/vault, Jump_Loop in the air): the body
                       sits ahead of the lens with the upper arms lifted (ARM_LIFT) and a clip plane
                       (CLIP_NEAR) cuts the torso so only forearms and hands reach the frame
  world/*              themes, sky (nebula, stars, lightning), abstract backdrop, the core, course meshes
  ui/hud.*             Marathon-style DOM HUD (Akira / Nulshock / Base Neue / Futurist / Hypik / TNN):
                       digital 7-segment km/h speedo + LED bar graph and stance stamp (bottom centre),
                       telemetry (flow, kicks, air time, clean-move chain), altitude tape, grapple lock-on
  editor/              map editor (segments + shapes, auto-validation, playtest)
  anims/ character_3d.fbx audio/ fonts/   user-supplied assets
reference/             mood board
```

### Course generation

Precision parkour, not a sprint: platforms are small floating slabs in a void, and every few
metres the route asks for a different move or direction. Headings are north/east/west only (never
south) so it can't cross itself.

**Pipeline.** `trackgen.js` plans the course from `gen/catalog.js` (one table: each set-piece's pick
weight and tags: `turn`, `family` (one grapple / one fork at a time), `precise` (small targets),
`fast` (fast exit), `calmIn` (sized for a normal entry speed), `rises`, `down`). Each module lays
its pieces through the `Builder` (`gen/builder.js`) in a local frame; the planner then checks the
new segment keeps clear of everything already built (solids, racing lines and alternate lines) and
rolls it back for another type if not. Each segment owns its rng stream, so the editor can reroll
one without touching the rest.

**Gauge** (`GAUGE` in `kit.js`). Every walkway is one width: runways, landings and catch decks are
one 4 m lane, so consecutive segments read as one built thing. Widths only change on purpose:
narrow 2.5 m (2 m on hard) hop plates and pads, and fork decks (`deckW(n)`: n × 3.5 m lanes with
0.75 m dividers) that widen through an apron and close back to the lane. `tools/gauge.js` measures it.

**Set-pieces.** Basics (`mod_basic`): `run`, `gap`, `stairs`, `pads`, `ledge`, `climb`, `ascent`,
`vault`, `slide`, `beam`, `ramp`, `drop`, `cascade`, `gauntlet`, `gallery`, `shuttle`. Walls and
turns (`mod_walls`): `wallrun`, `wallchain`, `pillarkick`, `tictac`, `kickchain`, `climbkick`,
`zigzag`, `kick`, `corner`, `turngap`. Grapple (`mod_grapple`): `swing`, `pivot`, `slalom`,
`switchback`. Hop spacing is computed from jump reach so a full-speed jump lands mid-target.

**Routes** (`mod_routes`, `Builder.routes([{ tag, lay }])`): 2–3 complete racing lines through one
stretch. The first is the main line (rival, progress, checkpoints); the others are alternates marked
with `ALT // SKILL LINE`, `SPEED LINE` or `HIGH LINE` signs in the level accent. `sim --alt N` races
route N of every fork, so every shortcut is proven makeable.
- `bypass`: climb over a monolith, or wallrun its flank over the void
- `split`: divided deck: vault + gate lane vs a long-gap lane; `overunder`: slide the duct or run over it
- `triple`: 3-lane hall: obstacle lane / wallrun along the outer wall / floating pads
- `terrace` (multi-level): low lane with vault, gate and a climb vs a high lane hopping blocks over
  pits; miss a hop and you land in the pit, climb the next block and carry on
- `speedtrap` (speed check, multi-level): a ramp ends in the void. Slide it and the speed carries you
  onto the high deck; run it and you fall short onto the low deck below, roll, and climb back up
- `speedcorner` (speed check, turn): slide the ramp and jump the corner diagonally onto the new leg,
  or run round the corner
- the cut variant of `corner`: diagonal hops across the inside of the turn over one pad

**Speed checks** are sized from the movement physics (`rampSpeeds`, `airTime` in `gen/builder.js`):
the gap sits between what a slid ramp reaches and what a flat-out run (full flow) reaches, so that a
runner who didn't slide meets the face more than a mantle's reach below the top. Entered hot, slide
late on the ramp (the bot does: it starts the slide once the drop left gives the target speed).
They are `calmIn`, so the planner never puts one straight after a fast exit. `tools/speedcheck.js`
races every check slid and unslid.

**Structure styles.** Sizes come from a palette (`q()` in `game/kit.js`: 0.5 m steps for sizes and
lengths, 0.25 m for offsets), not a continuum; all geometry snaps to a 0.25 m grid. Every slab
carries a structure **style** from the library, and a run of 2–4 modules shares one: `tiered`
(stepped keel), `pylon` (hanging column + cap), `truss` (edge girders + cross ribs) or `monolith`
(deep floating block). `dress()` builds each style all-or-nothing (falling back to a thin tier),
plus ribs on wallrun walls, plinths under climb monoliths and gantry frames over runways. Every
piece is a real solid that must stay clear of the main *and* alternate racing lines.

**Moving parts** (`shuttle`): platforms that sweep sideways, shuttle fore/aft or lift, all on one
clock per set-piece. Their position is a pure function of race time (`moveMovers`), so both racers
and the headless sim see identical motion; racers standing on one are carried (`Racer.ride`).
Every module emits collision boxes, a racing line and annotated actions; `tools/sim.js` races them
with a perfect bot (`--only speedtrap` tests one module; `tools/trace_only.js speedtrap SEED SECTOR`
traces it).

### Grapple (game/racer.js `stepHook` / `ropeConstraint`)

Anchors are nodes in `track.anchors` (the `swing` module or editor `anchor` shapes). Firing picks the
anchor with the smallest angle to the view (≤ 24°, ≤ 30 m, above the chest); the hook travels at
`hookSpeed`, so a late shot attaches with the runner already past the lip. The line reels in while
you run (length = closest distance on the ground) and is fixed once airborne. When it snaps taut,
most of the speed is redirected into the swing (not absorbed), so entry speed is swing energy:
faster in = higher arc and longer flight. A ground jump while hooked is a short hop (a full jump only
adds slack); jumping mid-swing lets go with an upward kick. The bot fires at the annotated
`grapple` action and lets go when a ballistic prediction lands on the far platform. Swing geometry
in the generator keeps the far edge further from the anchor than the lip (the arc crosses it higher)
and inside 88% of the rope's reach.

### HUD theme

Each theme in `world/themes.js` carries a `hud` palette (accent / ink / paper, optional `ahead`);
`Hud.setTheme` writes it into the CSS variables so the HUD always matches the sector.

### Runner vision

Anything you interact with is marked in acid: takeoff lips, wallrun bands (chevrons run in the
direction of travel), climb strips (chevrons point up), hazard-striped vaults/gates, redirect signs
at turns.

### Camera feel (fp/camera.js)

- step-synced head bob: a dip on every footfall + half-rate sway, scaled by speed; footstep audio fires on the same phase.
  Cadence model (step length grows with speed): ~2.2 steps/s at a jog up to ~3.3/s flat out
- spring landing dip + nod scaled by impact (capped); hard landings add shake and a light ASCII glyph overlay (scene colours, no grade change)
- wallrun tilt away from the wall, starting *before* contact when flying along a wall
- roll = fast forward somersault of the view; bank into turns; strafe lean
- speed FOV (70 → 82+), slide / wall-jump FOV kicks; peripheral blur + speed lines at speed
- `M` / `?calm` halves all of it and disables the somersault

Core loop: physics runs at a fixed 120 Hz. Gameplay is pure data (no Three.js in `game/racer.js`,
`trackgen.js`, `bot.js`), which is what lets `tools/sim.js` race thousands of laps headlessly.

**Flow**: clean moves (wall-jumps, climbs, vaults, rolls, slides under gates, clean gap jumps) fill
the FLOW meter (+22% top speed at max). Hard landings, wall bonks and falls empty it.

Selected course, name draft and camera settings are saved in `localStorage`. Runner identity
uses an HTTP-only cookie. Shared best times and record replays are stored in server-side SQLite.

### Stacked race sections

The generator now mixes three larger set-pieces into the regular parkour segments. All are also
available in the editor under **loops // stacked tracks**:

- `flyover`: climb around a loop, then cross eight metres above the approach.
- `helix`: a three-level spiral with overlapping return decks and two climbs.
- `dive`: descend around a loop and pass underneath the approach.

Each varies its footprint and mirrors left/right from its segment seed. These sections use cardinal
track ribbons (`gen/mod_multilevel.js`) with flat turning decks, ramps, directional signs and
respawn checkpoints. They can travel back over their own footprint while preserving the existing
module entry/exit frame. Every section has a marked diagonal jump cut before the exit; the main
route and the cut rejoin at the same exit and lead to the same finish. These are horizontal loops
and spirals; movement still uses the game's normal gravity.

Planning measures the full 3D route length, reserves solids, ramp volumes and both main/alternate
racing lines, and checks the final approach. Vertically separated geometry may share a footprint.
When a return leg boxes in a later section, the planner backs up and tries another sequence; it
never forces an overlapping fallback runway. Progress uses full 3D distance, and finishing also
requires reaching the gate's height.

Run `bun test tools/multilevel.test.js` for stacked-clearance, deterministic rebuild, shortcut
progress, finish-height and bot traversal tests across styles and entry headings. The broader
geometry audit is `bun tools/overlap.js --n 30`.
