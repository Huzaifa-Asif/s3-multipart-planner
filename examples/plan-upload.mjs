import assert from 'node:assert/strict';
import { planMultipartUpload } from 's3-multipart-planner';

const MiB = 1024 * 1024;
const plan = planMultipartUpload(260 * MiB, {
  preferredPartSize: 13 * MiB,
  concurrency: 4,
});

assert.equal(plan.partCount, 20);
assert.equal(plan.waves, 5);
assert.deepEqual(plan.parts[0], {
  partNumber: 1,
  start: 0,
  endExclusive: 13 * MiB,
  size: 13 * MiB,
  contentRange: `bytes 0-${13 * MiB - 1}/${260 * MiB}`,
});

console.log({
  partCount: plan.partCount,
  partSize: plan.partSize,
  waves: plan.waves,
  peakBufferedBytes: plan.peakBufferedBytes,
});
