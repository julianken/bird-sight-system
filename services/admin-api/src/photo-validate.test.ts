import { describe, it, expect } from 'vitest';
import { validatePhotoImage, validateLicense, ValidationError } from './validate.js';

describe('validatePhotoImage', () => {
  // Minimal valid JPEG: SOI + APP0/JFIF + EOI is enough for the magic-byte check.
  const jpegMagic = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // RIFF<4-byte size>WEBP — a real WebP container header.
  const webpMagic = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'ascii'),
  ]);
  // RIFF<size>WAVE — a non-WebP RIFF container (a .wav); must be rejected.
  const wavMagic = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WAVE', 'ascii'),
  ]);
  // ISO-BMFF box-size (4 bytes) + 'ftyp' marker at offset 4 — a valid AVIF head.
  const avifMagic = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x20]),
    Buffer.from('ftyp', 'ascii'),
  ]);

  it('accepts image/jpeg with jpeg magic bytes and returns ext "jpg"', () => {
    const { ext } = validatePhotoImage(Buffer.concat([jpegMagic, Buffer.alloc(2048)]), 'image/jpeg');
    expect(ext).toBe('jpg');
  });

  it('accepts image/png with png magic bytes and returns ext "png"', () => {
    const { ext } = validatePhotoImage(Buffer.concat([pngMagic, Buffer.alloc(2048)]), 'image/png');
    expect(ext).toBe('png');
  });

  it('accepts image/webp with RIFF....WEBP magic bytes and returns ext "webp"', () => {
    const { ext } = validatePhotoImage(Buffer.concat([webpMagic, Buffer.alloc(2048)]), 'image/webp');
    expect(ext).toBe('webp');
  });

  it('rejects a non-WEBP RIFF container (e.g. a .wav) declared image/webp', () => {
    expect(() => validatePhotoImage(Buffer.concat([wavMagic, Buffer.alloc(2048)]), 'image/webp'))
      .toThrow(/magic bytes/);
  });

  it('accepts image/avif with an ftyp box marker and returns ext "avif"', () => {
    const { ext } = validatePhotoImage(Buffer.concat([avifMagic, Buffer.alloc(2048)]), 'image/avif');
    expect(ext).toBe('avif');
  });

  it('rejects a non-image mime', () => {
    expect(() => validatePhotoImage(Buffer.alloc(2048), 'text/html')).toThrow(ValidationError);
  });

  it('rejects when magic bytes do not match the declared mime', () => {
    expect(() => validatePhotoImage(Buffer.concat([pngMagic, Buffer.alloc(2048)]), 'image/jpeg'))
      .toThrow(/magic bytes/);
  });

  it('rejects an empty body', () => {
    expect(() => validatePhotoImage(Buffer.alloc(0), 'image/jpeg')).toThrow(/empty/);
  });

  it('rejects a body below the minimum byte floor (likely an error page, not a photo)', () => {
    expect(() => validatePhotoImage(Buffer.concat([jpegMagic, Buffer.alloc(10)]), 'image/jpeg'))
      .toThrow(/too small/);
  });
});

describe('validateLicense', () => {
  it.each(['cc-by', 'cc-by-sa', 'cc0', 'CC-BY', 'CC0'])('accepts CC allowlist member %s', (lic) => {
    expect(validateLicense(lic)).toBe(lic.toLowerCase());
  });

  it.each(['cc-by-nc', 'cc-by-nd', 'cc-by-nc-sa', 'cc-by-nc-nd', 'arr', ''])(
    'rejects non-allowlisted / NC / ND license %s',
    (lic) => {
      expect(() => validateLicense(lic)).toThrow(ValidationError);
    },
  );
});
