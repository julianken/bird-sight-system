import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export interface PutResult {
  /** R2 object key (e.g. "family/cuculidae.a1b2c3d4.svg"). */
  key: string;
  /** Public URL served by the silhouettes Worker. */
  url: string;
}

export interface Storage {
  putSilhouette(familyCode: string, body: Buffer): Promise<PutResult>;
  deleteSilhouette(key: string): Promise<void>;
}

export function createStorage(): Storage {
  const endpoint = process.env.R2_ENDPOINT;
  if (!endpoint) throw new Error('R2_ENDPOINT is required');
  const bucket = process.env.R2_BUCKET_NAME ?? 'bird-maps-silhouettes';
  const publicPrefix = process.env.SILHOUETTES_PUBLIC_PREFIX ?? 'https://silhouettes.bird-maps.com';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
    region: 'auto',
    endpoint,
  };
  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = { accessKeyId, secretAccessKey };
  }
  const client = new S3Client(clientConfig);

  return {
    async putSilhouette(familyCode, body) {
      // Content-hash the body for a write-once-never-overwrite key. 8 hex chars
      // (32 bits) is plenty for a 10s-of-objects bucket and keeps URLs short.
      const sha = createHash('sha256').update(body).digest('hex').slice(0, 8);
      const key = `family/${familyCode}.${sha}.svg`;
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'image/svg+xml',
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return { key, url: `${publicPrefix}/${key}` };
    },
    async deleteSilhouette(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
