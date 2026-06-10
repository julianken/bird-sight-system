import { describe, it, expect } from 'vitest';
import { DISQUALIFIER_FLAGS, CRITERIA_KEYS } from './types.js';

describe('canonical vocabulary', () => {
  it('exports exactly the 9 disqualifier flags', () => {
    expect([...DISQUALIFIER_FLAGS]).toEqual([
      'dead', 'in-hand', 'specimen', 'sick', 'distant',
      'multiple-subjects', 'watermark', 'captive', 'harsh-flash',
    ]);
  });

  it('exports exactly the 7 criteria keys', () => {
    expect([...CRITERIA_KEYS]).toEqual([
      'framing', 'subjectClarity', 'liveness',
      'naturalness', 'pose', 'background', 'lighting',
    ]);
  });
});
