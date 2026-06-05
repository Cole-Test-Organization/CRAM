// Behavior tests for MentionTextarea — the @-tagging textarea used on the Agent
// page (and, later, notes). Guards: typing `@x` fires a DEBOUNCED search (a
// burst of keystrokes collapses to one call), results render grouped with the
// accounts bucket split into Accounts vs Partners, selecting a result inserts
// `@Label` and emits a chip carrying the exact resolved {type,id}, an `@` inside
// an email does NOT trigger the picker, and Enter selects while ⌘/Ctrl+Enter
// submits.

import { createSignal } from 'solid-js';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MentionTextarea, { type Mention } from './MentionTextarea';

const apiMock = vi.hoisted(() => ({
  // One unified result set covering every group the picker renders.
  search: vi.fn(async (_q: string) => ({
    query: _q,
    total: 5,
    results: {
      accounts: [
        { id: 10, name: 'Acme Corp', slug: 'acme-corp', status: 'account' },
        { id: 11, name: 'Acme Partners', slug: 'acme-partners', status: 'partner' },
      ],
      contacts: [
        { id: 20, full_name: 'Acme Person', title: 'CISO', account_name: 'Acme Corp', account_slug: 'acme-corp' },
      ],
      opportunities: [
        { id: 30, name: 'Acme POV', stage: 'pov_planning', account_name: 'Acme Corp', account_slug: 'acme-corp' },
      ],
      meetings: [
        { id: 40, title: 'Acme Kickoff', date: '2026-01-01', account_name: 'Acme Corp' },
      ],
    },
  })),
}));
vi.mock('../lib/api', () => ({ api: apiMock }));

beforeEach(() => vi.clearAllMocks());

// Controlled wrapper: wires value/mentions to local signals so the component
// behaves as it does in the app. Exposes the latest mentions via a spy.
function Harness(props: { onSubmit?: () => void; onMentions?: (m: Mention[]) => void }) {
  const [value, setValue] = createSignal('');
  const [mentions, setMentions] = createSignal<Mention[]>([]);
  return (
    <MentionTextarea
      value={value()}
      onInput={setValue}
      mentions={mentions()}
      onMentionsChange={(m) => {
        props.onMentions?.(m);
        setMentions(m);
      }}
      onSubmit={props.onSubmit}
      placeholder="Ask the agent…"
    />
  );
}

const getEditor = () => screen.getByPlaceholderText('Ask the agent…') as HTMLTextAreaElement;
// caret always at end — matches "user just typed this"
const type = (el: HTMLTextAreaElement, value: string) =>
  fireEvent.input(el, { target: { value, selectionStart: value.length, selectionEnd: value.length } });

describe('MentionTextarea', () => {
  it('debounces: a burst of keystrokes makes ONE search for the final token', async () => {
    render(() => <Harness />);
    const editor = getEditor();

    // three synchronous inputs — the debounce timer can't fire between them
    type(editor, '@a');
    type(editor, '@ac');
    type(editor, '@acme');

    await vi.waitFor(() => expect(apiMock.search).toHaveBeenCalled());
    expect(apiMock.search).toHaveBeenCalledTimes(1);
    expect(apiMock.search).toHaveBeenCalledWith('acme', 'all', expect.any(Number));
    // the superseded prefixes never hit the API
    expect(apiMock.search).not.toHaveBeenCalledWith('a', expect.anything(), expect.anything());
    expect(apiMock.search).not.toHaveBeenCalledWith('ac', expect.anything(), expect.anything());
  });

  it('renders results grouped, splitting the accounts bucket into Accounts vs Partners', async () => {
    render(() => <Harness />);
    type(getEditor(), '@acme');

    expect(await screen.findByText('Acme Corp')).toBeTruthy();
    // group headers
    expect(screen.getByText('Accounts')).toBeTruthy();
    expect(screen.getByText('Partners')).toBeTruthy();
    expect(screen.getByText('Contacts')).toBeTruthy();
    expect(screen.getByText('Opportunities')).toBeTruthy();
    expect(screen.getByText('Meetings')).toBeTruthy();
    // one row from each
    expect(screen.getByText('Acme Partners')).toBeTruthy();
    expect(screen.getByText('Acme Person')).toBeTruthy();
    expect(screen.getByText('Acme POV')).toBeTruthy();
    expect(screen.getByText('Acme Kickoff')).toBeTruthy();
  });

  it('selecting a result inserts @Label and emits a chip with the exact {type,id}', async () => {
    const onMentions = vi.fn();
    render(() => <Harness onMentions={onMentions} />);
    const editor = getEditor();
    type(editor, '@acme');

    fireEvent.mouseDown(await screen.findByText('Acme Corp'));

    // mention carries the resolved id + account type (NOT partner)
    await vi.waitFor(() =>
      expect(onMentions).toHaveBeenCalledWith([
        expect.objectContaining({ type: 'account', id: 10, label: 'Acme Corp' }),
      ]),
    );
    // chip rendered with id, and the cosmetic @Label landed in the text
    expect(screen.getByText('#10')).toBeTruthy();
    expect(editor.value).toContain('@Acme Corp');
  });

  it('tags a partner-status account as type "partner"', async () => {
    const onMentions = vi.fn();
    render(() => <Harness onMentions={onMentions} />);
    type(getEditor(), '@acme');

    fireEvent.mouseDown(await screen.findByText('Acme Partners'));

    await vi.waitFor(() =>
      expect(onMentions).toHaveBeenCalledWith([
        expect.objectContaining({ type: 'partner', id: 11 }),
      ]),
    );
  });

  it('does NOT trigger the picker for an @ inside an email', async () => {
    render(() => <Harness />);
    type(getEditor(), 'email dana@acme.com');

    // wait past the debounce window, then assert nothing fired
    await new Promise((r) => setTimeout(r, 220));
    expect(apiMock.search).not.toHaveBeenCalled();
    expect(screen.queryByText('Acme Corp')).toBeNull();
  });

  it('Enter selects the active result when the picker is open (no submit)', async () => {
    const onSubmit = vi.fn();
    render(() => <Harness onSubmit={onSubmit} />);
    const editor = getEditor();
    type(editor, '@acme');
    await screen.findByText('Acme Corp');

    fireEvent.keyDown(editor, { key: 'Enter' });

    expect(await screen.findByText('#10')).toBeTruthy(); // first item selected
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('⌘/Ctrl+Enter submits when the picker is closed', async () => {
    const onSubmit = vi.fn();
    render(() => <Harness onSubmit={onSubmit} />);
    const editor = getEditor();
    type(editor, 'just a plain prompt');

    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('removing a chip drops it from the mentions', async () => {
    const onMentions = vi.fn();
    render(() => <Harness onMentions={onMentions} />);
    type(getEditor(), '@acme');
    fireEvent.mouseDown(await screen.findByText('Acme Corp'));
    await screen.findByText('#10');

    fireEvent.click(screen.getByLabelText('Remove Acme Corp'));

    await vi.waitFor(() => expect(onMentions).toHaveBeenLastCalledWith([]));
    expect(screen.queryByText('#10')).toBeNull();
  });
});
