export interface MultipartPlanOptions {
  /** Desired bytes per part. Default: 8 MiB. Must be within S3 limits. */
  preferredPartSize?: number;
  /** Maximum simultaneous part uploads. Default: 4. */
  concurrency?: number;
  /** Round part sizes up to this byte multiple. Default: 1 MiB. */
  alignment?: number;
}

export interface MultipartPart {
  readonly partNumber: number;
  readonly start: number;
  readonly endExclusive: number;
  readonly size: number;
  readonly contentRange: string;
}

export interface MultipartPlan {
  readonly objectSize: number;
  readonly preferredPartSize: number;
  readonly partSize: number;
  readonly partSizeAdjusted: boolean;
  readonly minimumLegalPartSize: number;
  readonly partCount: number;
  readonly lastPartSize: number;
  readonly concurrency: number;
  readonly activeConcurrency: number;
  readonly waves: number;
  readonly peakBufferedBytes: number;
  readonly parts: readonly MultipartPart[];
}

export declare const S3_LIMITS: Readonly<{
  minPartSize: number;
  maxPartSize: number;
  maxParts: number;
  maxObjectSize: number;
}>;

export declare const DEFAULT_PART_SIZE: number;
export declare const DEFAULT_CONCURRENCY: number;

export declare class MultipartPlanError extends RangeError {
  readonly code: string;
  constructor(code: string, message: string);
}

export declare function planMultipartUpload(
  objectSize: number,
  options?: MultipartPlanOptions,
): MultipartPlan;

declare const api: {
  DEFAULT_CONCURRENCY: typeof DEFAULT_CONCURRENCY;
  DEFAULT_PART_SIZE: typeof DEFAULT_PART_SIZE;
  MultipartPlanError: typeof MultipartPlanError;
  S3_LIMITS: typeof S3_LIMITS;
  planMultipartUpload: typeof planMultipartUpload;
};

export default api;
