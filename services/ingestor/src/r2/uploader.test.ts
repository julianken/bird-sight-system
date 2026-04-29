import { describe, it, expect, beforeAll, afterAll, afterEach, vi, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// Mock @aws-sdk/client-s3 BEFORE importing uploader. Each test asserts on the
// captured PutObjectCommand input — never reaches a real R2 endpoint.
const sendMock = vi.fn();
const putObjectCommandSpy = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  class FakeS3Client {
    public config: unknown;
    constructor(config: unknown) {
      this.config = config;
    }
    send = sendMock;
  }
  class FakePutObjectCommand {
    public input: unknown;
    constructor(input: unknown) {
      this.input = input;
      putObjectCommandSpy(input);
    }
  }
  return {
    S3Client: FakeS3Client,
    PutObjectCommand: FakePutObjectCommand,
  };
});

// Import AFTER vi.mock so the uploader picks up the fake implementations.
import { uploadToR2, R2UploadError } from './uploader.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  sendMock.mockReset();
  putObjectCommandSpy.mockReset();
});
afterAll(() => server.close());

beforeEach(() => {
  process.env.R2_ENDPOINT = 'https://abc123.r2.cloudflarestorage.com';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.R2_BUCKET_NAME = 'birdwatch-photos';
});

describe('uploadToR2', () => {
  it('fetches the source image, calls S3 PutObject with key/body/ContentType, and returns the public CDN URL', async () => {
    const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic
    server.use(
      http.get('https://example.test/photo.jpg', () => {
        return new HttpResponse(imageBytes, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      })
    );
    sendMock.mockResolvedValueOnce({ ETag: '"abc"' });

    const url = await uploadToR2(
      'https://example.test/photo.jpg',
      'detail-panel/vermfly.jpg'
    );

    expect(url).toBe('https://photos.bird-maps.com/detail-panel/vermfly.jpg');
    expect(putObjectCommandSpy).toHaveBeenCalledTimes(1);
    const cmdInput = putObjectCommandSpy.mock.calls[0]?.[0] as {
      Bucket: string;
      Key: string;
      Body: Uint8Array;
      ContentType: string;
    };
    expect(cmdInput.Bucket).toBe('birdwatch-photos');
    expect(cmdInput.Key).toBe('detail-panel/vermfly.jpg');
    expect(cmdInput.ContentType).toBe('image/jpeg');
    // Body should round-trip the source bytes.
    expect(Buffer.from(cmdInput.Body).equals(Buffer.from(imageBytes))).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('throws R2UploadError when source fetch returns non-200', async () => {
    server.use(
      http.get('https://example.test/missing.jpg', () => {
        return new HttpResponse('not found', { status: 404 });
      })
    );

    await expect(
      uploadToR2('https://example.test/missing.jpg', 'detail-panel/x.jpg')
    ).rejects.toBeInstanceOf(R2UploadError);
    // S3 should never be called when source fetch fails.
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('is idempotent on re-upload of the same key (PutObject overwrites)', async () => {
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    server.use(
      http.get('https://example.test/dup.png', () => {
        return new HttpResponse(imageBytes, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      })
    );
    sendMock.mockResolvedValue({ ETag: '"first"' });

    const first = await uploadToR2(
      'https://example.test/dup.png',
      'detail-panel/dup.png'
    );
    const second = await uploadToR2(
      'https://example.test/dup.png',
      'detail-panel/dup.png'
    );

    expect(first).toBe('https://photos.bird-maps.com/detail-panel/dup.png');
    expect(second).toBe(first);
    expect(sendMock).toHaveBeenCalledTimes(2);
    // Both calls used the same key + bucket; PutObject is overwrite-by-default.
    const inputs = putObjectCommandSpy.mock.calls.map(
      (c) => c[0] as { Bucket: string; Key: string; ContentType: string }
    );
    expect(inputs[0]?.Key).toBe('detail-panel/dup.png');
    expect(inputs[1]?.Key).toBe('detail-panel/dup.png');
    expect(inputs[0]?.Bucket).toBe('birdwatch-photos');
    expect(inputs[1]?.Bucket).toBe('birdwatch-photos');
    expect(inputs[0]?.ContentType).toBe('image/png');
  });
});

describe('uploadToR2 ContentType detection', () => {
  beforeEach(() => {
    sendMock.mockResolvedValue({ ETag: '"x"' });
  });

  it('detects .jpeg as image/jpeg', async () => {
    server.use(
      http.get('https://example.test/p.jpeg', () =>
        new HttpResponse(new Uint8Array([1]), { status: 200 })
      )
    );
    await uploadToR2('https://example.test/p.jpeg', 'k.jpeg');
    expect(
      (putObjectCommandSpy.mock.calls[0]?.[0] as { ContentType: string })
        .ContentType
    ).toBe('image/jpeg');
  });

  it('detects .webp as image/webp', async () => {
    server.use(
      http.get('https://example.test/p.webp', () =>
        new HttpResponse(new Uint8Array([1]), { status: 200 })
      )
    );
    await uploadToR2('https://example.test/p.webp', 'k.webp');
    expect(
      (putObjectCommandSpy.mock.calls[0]?.[0] as { ContentType: string })
        .ContentType
    ).toBe('image/webp');
  });

  it('falls back to application/octet-stream for unknown extensions', async () => {
    server.use(
      http.get('https://example.test/p.bin', () =>
        new HttpResponse(new Uint8Array([1]), { status: 200 })
      )
    );
    await uploadToR2('https://example.test/p.bin', 'k.bin');
    expect(
      (putObjectCommandSpy.mock.calls[0]?.[0] as { ContentType: string })
        .ContentType
    ).toBe('application/octet-stream');
  });
});

describe('uploadToR2 env validation', () => {
  it('throws when R2_ENDPOINT is missing', async () => {
    delete process.env.R2_ENDPOINT;
    server.use(
      http.get('https://example.test/p.jpg', () =>
        new HttpResponse(new Uint8Array([1]), { status: 200 })
      )
    );
    await expect(
      uploadToR2('https://example.test/p.jpg', 'k.jpg')
    ).rejects.toBeInstanceOf(R2UploadError);
  });
});
