// Behavior tests for OrgChartPanel — the account org chart, rendered as a
// node-based flow chart (cards on a canvas, SVG connectors) rather than an
// indented list. The guards that earn their keep:
//   1. the tidy-tree layout puts reports in the layer BELOW their manager and
//      draws one connector per reporting edge — the "it looks like a DAG" core;
//   2. the manager dropdown omits the node itself and its descendants, the
//      invariant that stops a reporting cycle from ever being created;
//   3. changing a dropdown PATCHes through the api and re-lays-out from the
//      response (a contact promoted to Root visibly moves to the top layer).

import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { within } from '@testing-library/dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route } from '@solidjs/router';
import OrgChartPanel from './OrgChartPanel';
import type { OrgChart, OrgChartNode } from '../../lib/types';

const apiMock = vi.hoisted(() => ({
  getOrgChart: vi.fn<() => Promise<any>>(),
  setOrgChartManager: vi.fn<() => Promise<any>>(),
}));
vi.mock('../../lib/api', () => ({ api: apiMock }));

const mkNode = (id: number, full_name: string, over: Partial<OrgChartNode> = {}): OrgChartNode => ({
  id,
  full_name,
  company: null,
  title: null,
  email: null,
  phone: null,
  linkedin: null,
  kind: 'account',
  reports_to_contact_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
});

// Ada ← Grace ← Katherine chain, plus Margaret as an independent second root.
const baseChart = (): OrgChart => ({
  account_id: 7,
  nodes: [
    mkNode(1, 'Ada Lovelace', { title: 'CEO' }),
    mkNode(2, 'Grace Hopper', { title: 'VP Engineering', reports_to_contact_id: 1 }),
    mkNode(3, 'Katherine Johnson', { title: 'Engineer', reports_to_contact_id: 2 }),
    mkNode(4, 'Margaret Hamilton', { title: 'Director' }),
  ],
  edges: [
    { contact_id: 2, reports_to_contact_id: 1 },
    { contact_id: 3, reports_to_contact_id: 2 },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getOrgChart.mockResolvedValue(baseChart());
});

// <A> needs a router context, so mount the panel under a catch-all route.
async function setup() {
  const utils = render(() => (
    <MemoryRouter>
      <Route path="*" component={() => <OrgChartPanel accountId={7} />} />
    </MemoryRouter>
  ));
  await screen.findByRole('link', { name: 'Ada Lovelace' });
  const card = (id: number) => utils.container.querySelector(`[data-org-node="${id}"]`) as HTMLElement;
  const top = (id: number) => parseInt(card(id).style.top, 10);
  const left = (id: number) => parseInt(card(id).style.left, 10);
  return { ...utils, card, top, left };
}

describe('OrgChartPanel — flow chart layout', () => {
  it('positions reports in the layer below their manager and draws one connector per edge', async () => {
    const { container, top, left } = await setup();

    // Both roots share the top layer; each report sits strictly below its manager.
    expect(top(1)).toBe(0);
    expect(top(4)).toBe(0);
    expect(top(2)).toBeGreaterThan(top(1));
    expect(top(3)).toBeGreaterThan(top(2));

    // The two trees occupy separate columns instead of a shared indent gutter.
    expect(left(4)).not.toBe(left(1));

    // One SVG connector per reporting edge (Grace→Ada, Katherine→Grace).
    const edges = container.querySelectorAll('[data-org-edge]');
    expect(edges.length).toBe(2);
    for (const edge of edges) expect(edge.getAttribute('d')).toMatch(/^M /);
  });

  it('omits self and descendants from the manager dropdown so cycles cannot be created', async () => {
    await setup();

    const optionsFor = (name: string) =>
      within(screen.getByRole('combobox', { name: `Manager for ${name}` }))
        .getAllByRole('option')
        .map((option) => option.textContent);

    // Ada manages Grace who manages Katherine — none of the three may become her manager.
    expect(optionsFor('Ada Lovelace')).toEqual(['Root', 'Margaret Hamilton']);
    expect(optionsFor('Grace Hopper')).toEqual(['Root', 'Ada Lovelace', 'Margaret Hamilton']);
    // A leaf can report to anyone but herself.
    expect(optionsFor('Katherine Johnson')).toEqual(['Root', 'Ada Lovelace', 'Grace Hopper', 'Margaret Hamilton']);
  });

  it('PATCHes a manager change and re-lays-out from the response', async () => {
    const promoted = baseChart();
    promoted.edges = [{ contact_id: 2, reports_to_contact_id: 1 }];
    promoted.nodes[2].reports_to_contact_id = null;
    apiMock.setOrgChartManager.mockResolvedValue(promoted);

    const { top } = await setup();
    expect(top(3)).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole('combobox', { name: 'Manager for Katherine Johnson' }), {
      target: { value: '' },
    });

    expect(apiMock.setOrgChartManager).toHaveBeenCalledWith(7, 3, null);
    // Katherine is now a root: her card moves up to the top layer.
    await waitFor(() => expect(top(3)).toBe(0));
  });
});
