import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// @testing-library/react's auto-cleanup relies on a *global* afterEach, which
// this project doesn't enable (vitest.config.ts keeps `globals: false`); wire
// it up explicitly so each test starts from an empty DOM.
afterEach(() => {
  cleanup();
});
