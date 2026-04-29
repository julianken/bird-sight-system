import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Public URL prefix served by the photos Worker (task-1b). Bucket itself is
// private; this Worker is the only public read path. Hard-coded because it
// matches the DNS record provisioned in infra/terraform/photos.tf — changing
// the host means re-issuing a Cloudflare Worker route, not flipping a flag.
const PUBLIC_URL_PREFIX = 'https://photos.bird-maps.com';

const DEFAULT_BUCKET_NAME = 'birdwatch-photos';

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/**
 * Thrown for any failure reachable from uploadToR2: missing env, source-fetch
 * non-200, or S3 PutObject rejection. A single error class keeps the call
 * site (run-photos.ts, task-7) able to log-and-skip without juggling multiple
 * error types — those that need recovery distinguish via `cause` / message.
 */
export class R2UploadError extends Error {
  public override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'R2UploadError';
    this.cause = cause;
  }
}

/**
 * Downloads an image from `imageUrl` and uploads it to the Cloudflare R2
 * bucket at `destKey`, returning the public CDN URL served by the photos
 * Worker (task-1b).
 *
 * R2 endpoint, credentials and bucket name come from env (`R2_ENDPOINT`,
 * `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`). The endpoint
 * is required; credentials are optional in case the AWS SDK default chain is
 * preferable in some deploys, but R2's S3-compatible API expects access-key
 * pairs in practice and the run-photos orchestrator (task-7) sets them via
 * Secret Manager.
 *
 * Idempotency: PutObject overwrites by default at the same key, so re-running
 * this function for the same `destKey` succeeds without explicit dedup logic.
 */
export async function uploadToR2(
  imageUrl: string,
  destKey: string
): Promise<string> {
  const endpoint = process.env.R2_ENDPOINT;
  if (!endpoint) {
    throw new R2UploadError(
      'R2_ENDPOINT env var is required (e.g. https://<account-id>.r2.cloudflarestorage.com)'
    );
  }
  const bucket = process.env.R2_BUCKET_NAME ?? DEFAULT_BUCKET_NAME;

  // Step 1: fetch the source image. On any non-200 we fail fast — caller
  // (run-photos.ts) catches R2UploadError and skips this species.
  let res: Response;
  try {
    res = await fetch(imageUrl);
  } catch (err) {
    throw new R2UploadError(
      `Failed to fetch source image at ${imageUrl}: ${stringifyErr(err)}`,
      err
    );
  }
  if (!res.ok) {
    throw new R2UploadError(
      `Source fetch returned non-200 for ${imageUrl}: ${res.status}`
    );
  }
  const arrayBuf = await res.arrayBuffer();
  const body = new Uint8Array(arrayBuf);

  // Step 2: PutObject. Build a fresh S3Client per call — the upload path runs
  // monthly inside a Cloud Run job (task-8b), connection-reuse savings are
  // negligible vs the simplicity of a stateless function. If credentials are
  // unset we let the AWS SDK default-credential chain take over (e.g. for a
  // Workload-Identity-attached job in a future deploy variant).
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  // Build the config defensively under exactOptionalPropertyTypes: only set
  // `credentials` when both halves are present, otherwise let the AWS SDK
  // default-credential chain handle it (preserves the future Workload-
  // Identity deploy path).
  const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
    // R2 ignores region but the AWS SDK requires a non-empty string. 'auto' is
    // the documented sentinel for Cloudflare R2.
    region: 'auto',
    endpoint,
  };
  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = { accessKeyId, secretAccessKey };
  }
  const client = new S3Client(clientConfig);

  const contentType = detectContentType(imageUrl);

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: destKey,
        Body: body,
        ContentType: contentType,
      })
    );
  } catch (err) {
    throw new R2UploadError(
      `R2 PutObject failed for ${bucket}/${destKey}: ${stringifyErr(err)}`,
      err
    );
  }

  return `${PUBLIC_URL_PREFIX}/${destKey}`;
}

function detectContentType(imageUrl: string): string {
  // Strip query/hash before extension matching — iNat photo URLs are clean
  // today but we can't guarantee that for downstream callers. Lowercase the
  // suffix because URL paths are case-sensitive but extensions aren't in
  // practice (Macaulay/Wikimedia frequently mix-case .JPG).
  const pathOnly = imageUrl.split('?')[0]?.split('#')[0] ?? imageUrl;
  const lower = pathOnly.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  const ext = lower.slice(dot);
  return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
}

function stringifyErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
