// Behavior tests for EditableMarkdown — the click-to-edit markdown field used on
// account/opportunity/contact detail pages. Guards: preview→edit toggle, that
// every keystroke streams to onSave (it's wired to a debounced autosave), and
// that the save status surfaces through the inline SaveIndicator.

import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi } from 'vitest';
import EditableMarkdown from './EditableMarkdown';

describe('EditableMarkdown', () => {
  it('shows rendered content in preview, then reveals the editor on click', async () => {
    render(() => <EditableMarkdown content="Hello world" status="idle" onSave={() => {}} />);

    // Preview mode: content is shown, no editor yet.
    expect(screen.getByText('Hello world')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByText('Hello world'));

    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Hello world');
  });

  it('streams every keystroke to onSave', async () => {
    const onSave = vi.fn();
    render(() => <EditableMarkdown content="" status="idle" onSave={onSave} placeholder="Click to add content" />);

    // Empty content renders the placeholder hint; clicking it drops into edit mode.
    fireEvent.click(screen.getByText('Click to add content'));
    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement;

    fireEvent.input(textarea, { target: { value: 'first draft' } });
    expect(onSave).toHaveBeenCalledWith('first draft');
    expect(textarea.value).toBe('first draft');
  });

  it('surfaces the save status through SaveIndicator', () => {
    render(() => <EditableMarkdown content="x" status="saving" onSave={() => {}} />);
    expect(screen.getByText('Saving...')).toBeTruthy();
  });
});
