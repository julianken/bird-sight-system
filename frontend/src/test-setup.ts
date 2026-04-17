import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest sets globals:false so @testing-library/react cannot detect afterEach
// as a global. Register cleanup manually so DOM is cleared between tests.
afterEach(() => {
  cleanup();
});
