import one from './levels/level-1.json';
import two from './levels/level-2.json';
import three from './levels/level-3.json';
import four from './levels/level-4.json';
import five from './levels/level-5.json';
import six from './levels/level-6.json';
import { buildLevel } from './trackgen.js';

// Bump the revision when courses or movement physics change: old times/replays must not mix.
export const CAMPAIGN_VERSION = 'dcr-time-trial-v1';
export const COURSES = [one, two, three, four, five, six].map((level, i) => ({
  id: `level-${i + 1}`, number: i + 1, name: level.name, level,
}));
export const courseById = (id) => COURSES.find((course) => course.id === id);
export const buildCourse = (id) => {
  const course = courseById(id);
  if (!course) throw new Error('Unknown course');
  return buildLevel(course.level);
};
