// Sector palettes, each pulled from a reference board mood.
// Sector N uses THEMES[(N-1) % THEMES.length].
export const THEMES = [
  {
    id: 'steel',
    hud: { accent: '#9cc8ff', ink: '#060a12', paper: '#e4f0ff' },
    nebula: 0x3a6cff,
    label: 'ICE.VECTOR',
    fog: 0x060a12, fogDensity: 0.0042,
    skyTop: 0x010205, skyHorizon: 0x1a2a40, skyBottom: 0x000000, cloud: 0x2a4060,
    glow: 0xbfe4ff,
    line: 0x9cc8ff,
    chrome: 0xd0d8e4, chromeDark: 0x2a313c,
    env: [0xdfefff, 0x7fb4ff, 0xffffff],
    exposure: 1.0,
  },
  {
    id: 'storm',
    hud: { accent: '#e4ff1a', ink: '#0c0d0f', paper: '#f0f2ec' },
    nebula: 0x9aff3a,
    label: 'STORM.CELL',
    fog: 0x0c0d0f, fogDensity: 0.0040,
    skyTop: 0x030303, skyHorizon: 0x2b2d31, skyBottom: 0x000000, cloud: 0x45484e,
    glow: 0xf4ffb0,
    line: 0xe4ff1a,
    chrome: 0xc4c4c4, chromeDark: 0x2c2c2e,
    env: [0xffffff, 0xe4ff7a, 0xbfc4cc],
    exposure: 1.0,
  },
  {
    id: 'violet',
    hud: { accent: '#c8b6ff', ink: '#0d0820', paper: '#f4efff' },
    nebula: 0xb04cff,
    label: 'PRISM.DECAY',
    fog: 0x0d0820, fogDensity: 0.0040,
    skyTop: 0x050214, skyHorizon: 0x3a2a7c, skyBottom: 0x020008, cloud: 0x5a46a8,
    glow: 0xeee6ff,
    line: 0xc8b6ff,
    chrome: 0x9a92d4, chromeDark: 0x1c1834,
    env: [0xf2ecff, 0xa58cff, 0xffffff],
    exposure: 1.05,
  },
  {
    id: 'abyss',
    hud: { accent: '#ff3a44', ink: '#020203', paper: '#e2ebf5', ahead: '#e2ebf5' },   // ahead badge can't share the rival's red
    nebula: 0xff2a4a,
    label: 'NULL.HEART',
    fog: 0x020203, fogDensity: 0.0050,
    skyTop: 0x000000, skyHorizon: 0x0b1118, skyBottom: 0x000000, cloud: 0x16222e,
    glow: 0x9fd8ff,
    line: 0xff2a3a,
    chrome: 0x8c96a4, chromeDark: 0x15181d,
    env: [0xbfdcff, 0x4a6a8a, 0xff4050],
    exposure: 0.95,
  },
  {
    id: 'angel',
    hud: { accent: '#7fd0ff', ink: '#06154a', paper: '#ffffff' },
    nebula: 0x7fd0ff,
    label: 'HALO.STATIC',
    fog: 0x123b8c, fogDensity: 0.0036,
    skyTop: 0x06154a, skyHorizon: 0x5f9cff, skyBottom: 0x020a26, cloud: 0xa8c8ff,
    glow: 0xffffff,
    line: 0xe6f2ff,
    chrome: 0xd8ecff, chromeDark: 0x24407a,
    env: [0xffffff, 0x9cc4ff, 0xe8f4ff],
    exposure: 1.0,
  },
];

export function themeForSector(sector) {
  return THEMES[(sector - 1) % THEMES.length];
}

// Fixed racer colours (independent of theme so lanes always read clearly).
export const PLAYER_COLOR = 0xbff3ff;
// the runner's own body (first-person legs): a saturated blue, so the chrome reads blue, not white
export const PLAYER_BODY_COLOR = 0x2a6cff;
export const RIVAL_COLOR = 0xff2d55;
export const HAZARD_COLOR = 0xe4ff1a;
// pivot posts (horizontal whip turns) wear their own hot orange, so they never read as swing
// nodes: no sector palette is orange, and it stays clear of the rival's red
export const PIVOT_COLOR = 0xff7a1a;
