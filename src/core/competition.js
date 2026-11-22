import { CAMPAIGN_VERSION } from '../game/campaign.js';

async function request(path, body) {
  const response = await fetch(`api/${path}`, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(body?.inputs ? 30000 : 8000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || 'Leaderboard unavailable. You can still practice.');
  return data;
}
export const competition = {
  profile: () => request('profile'),
  register: (name) => request('profile', { name }),
  board: (course) => request(`levels/${course}/leaderboard?version=${CAMPAIGN_VERSION}`),
  ghost: (course) => request(`levels/${course}/ghost?version=${CAMPAIGN_VERSION}`),
  submit: (course, inputs) => request(`levels/${course}/runs`, { version: CAMPAIGN_VERSION, inputs }),
};
export const normalizeName = (name) => name.normalize('NFKC').trim().replace(/\s+/g, ' ');
export const validName = (name) => typeof name === 'string' && /^[\p{L}\p{N} _-]{2,20}$/u.test(name);
