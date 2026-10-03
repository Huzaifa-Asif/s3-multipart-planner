'use strict';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** Amazon S3 multipart limits, expressed in bytes. */
const S3_LIMITS = Object.freeze({
  minPartSize: 5 * MIB,
  maxPartSize: 5 * GIB,
  maxParts: 10_000,
  maxObjectSize: 5 * GIB * 10_000,
});

const DEFAULT_PART_SIZE = 8 * MIB;
const DEFAULT_CONCURRENCY = 4;

class MultipartPlanError extends RangeError {
  constructor(code, message) {
    super(message);
    this.name = 'MultipartPlanError';
    this.code = code;
  }
}

function assertPositiveSafeInteger(value, name, code) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new MultipartPlanError(
      code,
      `${name} must be a positive safe integer; received ${String(value)}`,
    );
  }
}

function roundUp(value, multiple) {
  return Math.ceil(value / multiple) * multiple;
}

/**
 * Build a deterministic upload plan without reading data or contacting S3.
 *
 * @param {number} objectSize total object size in bytes
 * @param {{ preferredPartSize?: number, concurrency?: number, alignment?: number }} [options]
 */
function planMultipartUpload(objectSize, options = {}) {
  assertPositiveSafeInteger(objectSize, 'objectSize', 'INVALID_OBJECT_SIZE');

  if (objectSize > S3_LIMITS.maxObjectSize) {
    throw new MultipartPlanError(
      'OBJECT_TOO_LARGE',
      `objectSize exceeds the S3 multipart maximum of ${S3_LIMITS.maxObjectSize} bytes`,
    );
  }

  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }

  const preferredPartSize = options.preferredPartSize ?? DEFAULT_PART_SIZE;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const alignment = options.alignment ?? MIB;

  assertPositiveSafeInteger(
    preferredPartSize,
    'preferredPartSize',
    'INVALID_PART_SIZE',
  );
  if (
    preferredPartSize < S3_LIMITS.minPartSize ||
    preferredPartSize > S3_LIMITS.maxPartSize
  ) {
    throw new MultipartPlanError(
      'INVALID_PART_SIZE',
      `preferredPartSize must be between ${S3_LIMITS.minPartSize} and ${S3_LIMITS.maxPartSize} bytes`,
    );
  }

  assertPositiveSafeInteger(concurrency, 'concurrency', 'INVALID_CONCURRENCY');
  if (concurrency > S3_LIMITS.maxParts) {
    throw new MultipartPlanError(
      'INVALID_CONCURRENCY',
      `concurrency cannot exceed ${S3_LIMITS.maxParts}`,
    );
  }

  assertPositiveSafeInteger(alignment, 'alignment', 'INVALID_ALIGNMENT');
  if (alignment > S3_LIMITS.maxPartSize) {
    throw new MultipartPlanError(
      'INVALID_ALIGNMENT',
      `alignment cannot exceed ${S3_LIMITS.maxPartSize} bytes`,
    );
  }

  const minimumForPartLimit = Math.ceil(objectSize / S3_LIMITS.maxParts);
  const minimumLegalPartSize = Math.max(
    S3_LIMITS.minPartSize,
    roundUp(minimumForPartLimit, alignment),
  );
  const partSize = roundUp(
    Math.max(preferredPartSize, minimumLegalPartSize),
    alignment,
  );

  if (partSize > S3_LIMITS.maxPartSize) {
    throw new MultipartPlanError(
      'ALIGNMENT_EXCEEDS_LIMIT',
      'The requested alignment makes a legal S3 part size impossible',
    );
  }

  const partCount = Math.ceil(objectSize / partSize);
  const lastPartSize = objectSize - partSize * (partCount - 1);
  const activeConcurrency = Math.min(concurrency, partCount);
  const peakBufferedBytes =
    partCount <= concurrency
      ? partSize * (partCount - 1) + lastPartSize
      : partSize * concurrency;

  const parts = Array.from({ length: partCount }, (_, index) => {
    const start = index * partSize;
    const size = index === partCount - 1 ? lastPartSize : partSize;
    const endExclusive = start + size;

    return Object.freeze({
      partNumber: index + 1,
      start,
      endExclusive,
      size,
      contentRange: `bytes ${start}-${endExclusive - 1}/${objectSize}`,
    });
  });

  return Object.freeze({
    objectSize,
    preferredPartSize,
    partSize,
    partSizeAdjusted: partSize !== preferredPartSize,
    minimumLegalPartSize,
    partCount,
    lastPartSize,
    concurrency,
    activeConcurrency,
    waves: Math.ceil(partCount / concurrency),
    peakBufferedBytes,
    parts: Object.freeze(parts),
  });
}

module.exports = {
  DEFAULT_CONCURRENCY,
  DEFAULT_PART_SIZE,
  MultipartPlanError,
  S3_LIMITS,
  planMultipartUpload,
};
