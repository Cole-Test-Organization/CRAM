import { afterEach } from 'vitest';
import { cleanup } from '@solidjs/testing-library';

// Unmount whatever a test rendered so component state can't leak into the next.
afterEach(() => cleanup());
