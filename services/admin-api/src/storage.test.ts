import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createStorage } from './storage.js';

const s3Mock = mockClient(S3Client);

describe('storage', () => {
  beforeEach(() => {
    s3Mock.reset();
    process.env.R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
    process.env.R2_BUCKET_NAME = 'bird-maps-silhouettes';
    process.env.R2_ACCESS_KEY_ID = 'akid';
    process.env.R2_SECRET_ACCESS_KEY = 'sak';
    process.env.SILHOUETTES_PUBLIC_PREFIX = 'https://silhouettes.bird-maps.com';
  });

  it('putSilhouette uploads at family/<code>.<sha8>.svg and returns the public URL', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const storage = createStorage();
    const body = Buffer.from('<svg><path d="M1 1"/></svg>', 'utf8');
    const result = await storage.putSilhouette('cuculidae', body);
    expect(result.key).toMatch(/^family\/cuculidae\.[0-9a-f]{8}\.svg$/);
    expect(result.url).toBe(`https://silhouettes.bird-maps.com/${result.key}`);
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toMatchObject({
      Bucket: 'bird-maps-silhouettes',
      Key: result.key,
      ContentType: 'image/svg+xml',
    });
  });

  it('deleteSilhouette removes the given key', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    const storage = createStorage();
    await storage.deleteSilhouette('family/cuculidae.deadbeef.svg');
    const calls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toMatchObject({
      Bucket: 'bird-maps-silhouettes',
      Key: 'family/cuculidae.deadbeef.svg',
    });
  });

  it('content hash is deterministic for the same body', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const storage = createStorage();
    const body = Buffer.from('<svg><path d="M1 1"/></svg>', 'utf8');
    const r1 = await storage.putSilhouette('cuculidae', body);
    const r2 = await storage.putSilhouette('cuculidae', body);
    expect(r1.key).toBe(r2.key);
  });

  it('content hash changes when body changes', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const storage = createStorage();
    const a = await storage.putSilhouette('cuculidae', Buffer.from('a'));
    const b = await storage.putSilhouette('cuculidae', Buffer.from('b'));
    expect(a.key).not.toBe(b.key);
  });

  it('throws when R2_ENDPOINT is missing', () => {
    delete process.env.R2_ENDPOINT;
    expect(() => createStorage()).toThrow(/R2_ENDPOINT/);
  });
});
