import { buildCourse } from '../src/game/campaign.js';
import { verifyRun } from '../src/game/replay.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: verifyRun(buildCourse(data.course), data.inputs) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
