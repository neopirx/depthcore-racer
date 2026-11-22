import { timingSafeEqual } from 'node:crypto';

export function isAdmin(headers, env = process.env) {
  if (!env.ADMIN_USER || !env.ADMIN_PASSWORD) return false;
  const actual = Buffer.from(headers.get('authorization') || '');
  const expected = Buffer.from(`Basic ${Buffer.from(`${env.ADMIN_USER}:${env.ADMIN_PASSWORD}`).toString('base64')}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const adminChallenge = () => new Response('Admin access required.', {
  status: 401, headers: { 'WWW-Authenticate': 'Basic realm="DEPTHCORE admin", charset="UTF-8"', 'Cache-Control': 'no-store' },
});
