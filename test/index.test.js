import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  DEFAULT_PART_SIZE,
  MultipartPlanError,
  S3_LIMITS,
  planMultipartUpload,
} from '../src/index.js';

const MiB = 1024 * 1024;

test('exports the same planner to ESM and CommonJS consumers', () => {
  const require = createRequire(import.meta.url);
  const commonJs = require('../src/index.cjs');
  assert.equal(commonJs.planMultipartUpload, planMultipartUpload);
  assert.equal(DEFAULT_PART_SIZE, 8 * MiB);
});

test('plans exact byte ranges and a small final part', () => {
  const plan = planMultipartUpload(13 * MiB, {
    preferredPartSize: 5 * MiB,
    concurrency: 2,
  });

  assert.equal(plan.partCount, 3);
  assert.equal(plan.lastPartSize, 3 * MiB);
  assert.equal(plan.waves, 2);
  assert.equal(plan.peakBufferedBytes, 10 * MiB);
  assert.deepEqual(plan.parts[2], {
    partNumber: 3,
    start: 10 * MiB,
    endExclusive: 13 * MiB,
    size: 3 * MiB,
    contentRange: `bytes ${10 * MiB}-${13 * MiB - 1}/${13 * MiB}`,
  });
});

test('permits one last part smaller than the normal minimum', () => {
  const plan = planMultipartUpload(1);
  assert.equal(plan.partCount, 1);
  assert.equal(plan.lastPartSize, 1);
  assert.equal(plan.peakBufferedBytes, 1);
  assert.equal(plan.parts[0].contentRange, 'bytes 0-0/1');
});

test('handles exact minimum-size boundaries without a zero-length final part', () => {
  for (const objectSize of [5 * MiB - 1, 5 * MiB, 5 * MiB + 1, 16 * MiB]) {
    const plan = planMultipartUpload(objectSize, {
      preferredPartSize: 8 * MiB,
    });
    assert.ok(plan.lastPartSize > 0);
    assert.equal(plan.parts.at(-1).endExclusive, objectSize);
  }

  const exact = planMultipartUpload(16 * MiB, {
    preferredPartSize: 8 * MiB,
  });
  assert.equal(exact.partCount, 2);
  assert.equal(exact.lastPartSize, 8 * MiB);
});

test('raises part size to stay within 10,000 parts', () => {
  const objectSize = S3_LIMITS.minPartSize * S3_LIMITS.maxParts + 1;
  const plan = planMultipartUpload(objectSize, {
    preferredPartSize: S3_LIMITS.minPartSize,
  });

  assert.equal(plan.partSizeAdjusted, true);
  assert.equal(plan.partSize, 6 * MiB);
  assert.ok(plan.partCount <= S3_LIMITS.maxParts);
});

test('keeps the exact 10,000-part boundary and adjusts one byte beyond it', () => {
  const preferredPartSize = 5 * MiB;
  const exact = planMultipartUpload(preferredPartSize * 10_000, {
    preferredPartSize,
  });
  const over = planMultipartUpload(preferredPartSize * 10_000 + 1, {
    preferredPartSize,
  });

  assert.equal(exact.partCount, 10_000);
  assert.equal(exact.partSizeAdjusted, false);
  assert.equal(over.partSize, 6 * MiB);
  assert.ok(over.partCount <= 10_000);
});

test('covers the current maximum object size exactly', () => {
  const plan = planMultipartUpload(S3_LIMITS.maxObjectSize, {
    preferredPartSize: S3_LIMITS.maxPartSize,
  });
  assert.equal(S3_LIMITS.maxObjectSize, 53_687_091_200_000);
  assert.equal(plan.partCount, 10_000);
  assert.equal(plan.partSize, S3_LIMITS.maxPartSize);
  assert.equal(plan.lastPartSize, S3_LIMITS.maxPartSize);
});

test('plans beyond the historical 5 TiB ceiling using current S3 limits', () => {
  const historicalFiveTiB = 5 * 1024 ** 4;
  const plan = planMultipartUpload(historicalFiveTiB + 1);
  assert.equal(plan.objectSize, historicalFiveTiB + 1);
  assert.ok(plan.partCount <= S3_LIMITS.maxParts);
  assert.ok(plan.partSize <= S3_LIMITS.maxPartSize);
});

test('adjusts a plan that would require a 5 GiB part plus one byte', () => {
  const objectSize = S3_LIMITS.maxPartSize + 1;
  const plan = planMultipartUpload(objectSize, {
    preferredPartSize: S3_LIMITS.maxPartSize,
  });
  assert.equal(plan.partCount, 2);
  assert.equal(plan.parts[0].size, S3_LIMITS.maxPartSize);
  assert.equal(plan.parts[1].size, 1);
});

test('uses actual object bytes for peak buffering when all parts fit at once', () => {
  const objectSize = 17 * MiB;
  const plan = planMultipartUpload(objectSize, {
    preferredPartSize: 8 * MiB,
    concurrency: 10,
  });
  assert.equal(plan.activeConcurrency, 3);
  assert.equal(plan.peakBufferedBytes, objectSize);
});

test('supports custom alignment', () => {
  const objectSize = 55_000_000_001;
  const plan = planMultipartUpload(objectSize, {
    preferredPartSize: S3_LIMITS.minPartSize,
    alignment: 1_000_000,
  });
  assert.equal(plan.partSize % 1_000_000, 0);
  assert.ok(plan.partCount <= S3_LIMITS.maxParts);
});

test('rejects invalid inputs with actionable codes', () => {
  for (const value of [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    NaN,
    Infinity,
    '10',
    10n,
    null,
  ]) {
    assert.throws(
      () => planMultipartUpload(value),
      (error) =>
        error instanceof MultipartPlanError &&
        error.code === 'INVALID_OBJECT_SIZE',
    );
  }

  assert.throws(
    () => planMultipartUpload(S3_LIMITS.maxObjectSize + 1),
    (error) => error.code === 'OBJECT_TOO_LARGE',
  );
  assert.throws(
    () => planMultipartUpload(10 * MiB, { preferredPartSize: MiB }),
    (error) => error.code === 'INVALID_PART_SIZE',
  );
  assert.throws(
    () => planMultipartUpload(10 * MiB, { concurrency: 0 }),
    (error) => error.code === 'INVALID_CONCURRENCY',
  );
  assert.throws(
    () => planMultipartUpload(10 * MiB, { concurrency: 1.5 }),
    (error) => error.code === 'INVALID_CONCURRENCY',
  );
  assert.throws(
    () => planMultipartUpload(10 * MiB, { concurrency: 10_001 }),
    (error) => error.code === 'INVALID_CONCURRENCY',
  );
  assert.throws(
    () => planMultipartUpload(10 * MiB, { alignment: 0 }),
    (error) => error.code === 'INVALID_ALIGNMENT',
  );
  assert.throws(
    () =>
      planMultipartUpload(S3_LIMITS.maxObjectSize, {
        preferredPartSize: S3_LIMITS.maxPartSize,
        alignment: S3_LIMITS.maxPartSize - 1,
      }),
    (error) => error.code === 'ALIGNMENT_EXCEEDS_LIMIT',
  );
  assert.throws(() => planMultipartUpload(10 * MiB, null), TypeError);
  assert.throws(() => planMultipartUpload(10 * MiB, []), TypeError);
});

test('preserves range invariants across deterministic generated sizes', () => {
  let state = 0x5eed1234;
  for (let iteration = 0; iteration < 500; iteration += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const objectSize = 1 + (state % (2 * 1024 * MiB));
    const plan = planMultipartUpload(objectSize);

    assert.ok(plan.partCount <= S3_LIMITS.maxParts);
    assert.equal(plan.parts[0].start, 0);
    assert.equal(plan.parts.at(-1).endExclusive, objectSize);
    assert.equal(
      plan.parts.reduce((total, part) => total + part.size, 0),
      objectSize,
    );
    for (let index = 0; index < plan.parts.length - 1; index += 1) {
      assert.equal(plan.parts[index].size, plan.partSize);
      assert.equal(plan.parts[index].endExclusive, plan.parts[index + 1].start);
      assert.ok(plan.parts[index].size >= S3_LIMITS.minPartSize);
      assert.ok(plan.parts[index].size <= S3_LIMITS.maxPartSize);
    }
  }
});
