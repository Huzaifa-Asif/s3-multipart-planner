import api from './index.cjs';

export const {
  DEFAULT_CONCURRENCY,
  DEFAULT_PART_SIZE,
  MultipartPlanError,
  S3_LIMITS,
  planMultipartUpload,
} = api;

export default api;
