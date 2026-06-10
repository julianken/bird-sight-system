import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createStorage } from './storage.js';

const s3Mock = mockClient(S3Client);

describe('storage — species photos', () => {
  beforeEach(() => {
    s3Mock.reset();
    process.env.R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
    process.env.R2_PHOTOS_BUCKET = 'birdwatch-photos';
    process.env.R2_ACCESS_KEY_ID = 'akid';
    process.env.R2_SECRET_ACCESS_KEY = 'sak';
    process.env.SPECIES_PHOTOS_PUBLIC_PREFIX = 'https://photos.bird-maps.com';
  });

  it('putSpeciesPhoto uploads at species/<code>.<sha8>.<ext> in the photos bucket', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const storage = createStorage();
    const body = Buffer.from('fake-jpeg-bytes', 'utf8');
    const result = await storage.putSpeciesPhoto('norcar', body, 'image/jpeg', 'jpg');
    expect(result.key).toMatch(/^species\/norcar\.[0-9a-f]{8}\.jpg$/);
    expect(result.url).toBe(`https://photos.bird-maps.com/${result.key}`);
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toMatchObject({
      Bucket: 'birdwatch-photos',
      Key: result.key,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('content hash changes when body changes; stable when it does not', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const storage = createStorage();
    const a = await storage.putSpeciesPhoto('norcar', Buffer.from('a'), 'image/jpeg', 'jpg');
    const a2 = await storage.putSpeciesPhoto('norcar', Buffer.from('a'), 'image/jpeg', 'jpg');
    const b = await storage.putSpeciesPhoto('norcar', Buffer.from('b'), 'image/jpeg', 'jpg');
    expect(a.key).toBe(a2.key);
    expect(a.key).not.toBe(b.key);
  });

  it('deleteSpeciesPhoto removes the given key from the photos bucket', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    const storage = createStorage();
    await storage.deleteSpeciesPhoto('species/norcar.deadbeef.jpg');
    const calls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toMatchObject({
      Bucket: 'birdwatch-photos',
      Key: 'species/norcar.deadbeef.jpg',
    });
  });
});
