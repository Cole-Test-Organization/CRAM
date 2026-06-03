// Smoke tests for SaveIndicator — small, but it has real branching (status →
// label) and an idle-renders-nothing rule worth pinning down.

import { render, screen } from '@solidjs/testing-library';
import { describe, it, expect } from 'vitest';
import SaveIndicator from './SaveIndicator';

describe('SaveIndicator', () => {
  it('renders nothing while idle', () => {
    const { container } = render(() => <SaveIndicator status="idle" />);
    expect(container.textContent).toBe('');
  });

  it('shows the right label for each active status', () => {
    const cases = [
      ['saving', 'Saving...'],
      ['saved', 'Saved'],
      ['error', 'Error'],
    ] as const;
    for (const [status, label] of cases) {
      const { unmount } = render(() => <SaveIndicator status={status} />);
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });
});
