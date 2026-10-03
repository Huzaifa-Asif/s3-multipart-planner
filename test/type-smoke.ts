import planner, {
  MultipartPlanError,
  S3_LIMITS,
  planMultipartUpload,
  type MultipartPlan,
} from 's3-multipart-planner';

const plan: MultipartPlan = planMultipartUpload(32 * 1024 * 1024, {
  concurrency: 2,
});

const count: number = plan.partCount;
const maximum: number = S3_LIMITS.maxObjectSize;
const samePlan: MultipartPlan = planner.planMultipartUpload(maximum);

if (count < 1 || samePlan.parts.length < 1) {
  throw new MultipartPlanError('IMPOSSIBLE', 'Type smoke test');
}
