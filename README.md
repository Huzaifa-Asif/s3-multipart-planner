# s3-multipart-planner

[![CI](https://github.com/Huzaifa-Asif/s3-multipart-planner/actions/workflows/ci.yml/badge.svg)](https://github.com/Huzaifa-Asif/s3-multipart-planner/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/s3-multipart-planner.svg)](https://www.npmjs.com/package/s3-multipart-planner)
[![license](https://img.shields.io/npm/l/s3-multipart-planner.svg)](LICENSE)

Plan valid Amazon S3 multipart upload chunks before you allocate buffers, create
presigned URLs, or send a request. It has zero runtime dependencies and does not
need AWS credentials.

This package answers deterministic questions:

- How large must each part be to stay at or below 10,000 parts?
- Which byte range belongs to each part?
- How many concurrency waves are planned?
- What is the upper-bound payload buffered if every worker holds one full part?

It deliberately does **not** predict upload speed. Network latency, bandwidth,
HTTP connection reuse, retries, server-side throttling, checksums, and client
implementation usually matter as much as—or more than—chunk size.

## Install

```sh
npm install s3-multipart-planner
```

Requires Node.js 18 or later. The package ships ESM, CommonJS, and TypeScript
declarations and can also be bundled for browsers.

## Quick start

```js
import { planMultipartUpload } from 's3-multipart-planner';

const MiB = 1024 * 1024;
const plan = planMultipartUpload(260 * MiB, {
  preferredPartSize: 13 * MiB,
  concurrency: 4,
});

console.log(plan.partCount);        // 20 planned UploadPart calls
console.log(plan.waves);            // 5 idealized concurrency waves
console.log(plan.peakBufferedBytes); // 54,525,952 (52 MiB)
console.log(plan.parts[0]);
// {
//   partNumber: 1,
//   start: 0,
//   endExclusive: 13631488,
//   size: 13631488,
//   contentRange: 'bytes 0-13631487/272629760'
// }
```

CommonJS works too:

```js
const { planMultipartUpload } = require('s3-multipart-planner');
```

## API

### `planMultipartUpload(objectSize, options?)`

`objectSize` is a positive, safe-integer byte count. All legal S3 multipart
sizes are below JavaScript's safe-integer limit, so `bigint` is not accepted.
For a zero-byte object, use S3 `PutObject`; there is no useful multipart plan.

Options:

| Option | Default | Meaning |
| --- | ---: | --- |
| `preferredPartSize` | 8 MiB | Desired bytes per part; must be 5 MiB–5 GiB |
| `concurrency` | 4 | Maximum number of parts processed at once |
| `alignment` | 1 MiB | Round the selected part size up to this byte multiple |

The planner increases `preferredPartSize` only when necessary to keep the plan
within 10,000 parts, then rounds up to `alignment`. Inspect
`partSizeAdjusted` and the final `partSize` rather than assuming the preference
was used verbatim. Invalid preferences fail early instead of being silently
clamped.

The returned object contains:

| Field | Meaning |
| --- | --- |
| `partSize` | Selected size of every non-final part |
| `partCount` | Planned payload-call count, excluding retries and control-plane calls |
| `lastPartSize` | Final part size; S3 allows it to be below 5 MiB |
| `parts` | Frozen array of 1-based part numbers and half-open byte ranges |
| `waves` | `ceil(partCount / concurrency)`; a scheduling count, not a time estimate |
| `activeConcurrency` | Workers that can be active given the number of parts |
| `peakBufferedBytes` | Upper bound if each active worker buffers its entire payload |
| `minimumLegalPartSize` | Smallest aligned size that satisfies S3's part-count limit |

`contentRange` is included for systems that use HTTP byte ranges. The native S3
`UploadPart` API takes a body and part number; it does not require this header.

### `S3_LIMITS`

Exports the constraints used by the planner: 5 MiB minimum part size, 5 GiB
maximum part size, 10,000 parts, and a computed maximum of
53,687,091,200,000 bytes (`5 GiB × 10,000`). The last part is exempt from the
minimum.

### Errors

Validation failures throw `MultipartPlanError`, a `RangeError` with a stable
`code`, such as `INVALID_OBJECT_SIZE`, `INVALID_PART_SIZE`,
`OBJECT_TOO_LARGE`, or `ALIGNMENT_EXCEEDS_LIMIT`.

## Using a plan

The package is SDK-agnostic. A typical uploader reads each half-open range
`[start, endExclusive)`, sends it with `partNumber`, records the returned ETag,
then completes the multipart upload in ascending part order.

`partCount` counts planned `UploadPart` payload requests only. The baseline
multipart sequence is therefore `partCount + 2` network calls: create, parts,
and complete. A real upload may also make abort, checksum, retry, redirect,
discovery, or credential-refresh requests. `peakBufferedBytes` is
`min(objectSize, activeConcurrency × partSize)` and assumes each active worker
holds one complete part; streaming SDKs may buffer less, while transforms,
checksums, retries, and SDK queues may buffer more. For example, AWS SDK upload
helpers have their own queue and buffering behavior.

## Limits and non-goals

- This plans ranges; it does not read files, upload data, sign requests, or pick
  the fastest chunk size.
- The current S3 documentation describes a 48.8 TiB maximum implied by 10,000
  × 5 GiB parts. Some SDK releases, S3-compatible providers, and older tooling
  still document or enforce a historical 5 TiB object limit. Verify the client
  and service you actually deploy.
- Memory and timing fields are planning estimates, not runtime measurements.
- Ranges use an inclusive `start` and exclusive `endExclusive`. S3 copy-range
  APIs commonly use an inclusive end, so convert deliberately.
- `parts` contains up to 10,000 entries. That is intentional for easy range and
  presigned-URL generation.
- JavaScript `number` is used instead of `bigint`; the package accepts integers
  only and verifies `Number.isSafeInteger`.

## Why this exists

An [open issue on a public parallel-upload example](https://github.com/Huzaifa-Asif/aws-s3-fast-upload/issues/1)
asks why changing chunk sizes did not materially change a 260 MB upload time.
Existing tools found during the initial research—such as
[`@aws-sdk/lib-storage`](https://www.npmjs.com/package/@aws-sdk/lib-storage),
[`s3`](https://www.npmjs.com/package/s3), and
[`s3-upload-stream`](https://www.npmjs.com/package/s3-upload-stream)—perform
uploads and may adjust part sizes internally. Uppy also exposes
[multipart chunk sizing](https://uppy.io/docs/aws-s3/). This package has a
narrower role: make the legal chunk plan, exact ranges, and resource tradeoffs
inspectable before an uploader runs. It does not claim that multipart sizing is
a novel concept.

The constraints come from AWS's
[S3 multipart upload limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html).
AWS's [multipart overview](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
documents the create/upload/complete lifecycle.
AWS's [JavaScript SDK migration guide](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html)
points upload users to `@aws-sdk/lib-storage`.

## Troubleshooting

**`INVALID_PART_SIZE`** — Pass a whole-byte value from 5 MiB through 5 GiB.
Remember that MiB is `1024 * 1024`, not one million bytes.

**`partSizeAdjusted` is `true`** — The preferred size would create more than
10,000 parts or was rounded to the requested alignment. Use `plan.partSize` for
the actual reads.

**Actual memory is higher than `peakBufferedBytes`** — Inspect your SDK queue,
stream high-water marks, retry buffers, transforms, and checksum implementation.

**Changing the part size did not speed up the upload** — Compare concurrency,
bandwidth, latency, connection reuse, CPU/checksum cost, and server throttling.
The plan describes work; it does not benchmark the path.

## Runnable example and related tool

Run [`examples/plan-upload.mjs`](examples/plan-upload.mjs) for a deterministic
260 MiB plan that checks part boundaries, concurrency waves, and buffer usage.
The example ships in the npm tarball.

For validating HTTP byte-range resume responses rather than planning S3 upload
parts, see [`resume-range-audit`](https://www.npmjs.com/package/resume-range-audit).

## Development

```sh
npm test
npm run lint
npm run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the
[changelog](CHANGELOG.md). Released under the [MIT License](LICENSE).
