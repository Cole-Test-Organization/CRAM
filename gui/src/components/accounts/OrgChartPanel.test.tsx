import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { within } from '@testing-library/dom';
import { MemoryRouter, Route } from '@solidjs/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrgChartPanel from './OrgChartPanel';
import type { OrgChart, OrgChartContact, OrgChartNode } from '../../lib/types';

const apiMock = vi.hoisted(() => ({
  getOrgChart: vi.fn<() => Promise<any>>(),
  setOrgChartManager: vi.fn<() => Promise<any>>(),
  removeOrgChartContact: vi.fn<() => Promise<any>>(),
}));
vi.mock('../../lib/api', () => ({ api: apiMock }));

const mkContact = (id: number, full_name: string, over: Partial<OrgChartContact> = {}): OrgChartContact => ({
  id,
  full_name,
  company: 'Analytical Engines',
  title: null,
  email: null,
  phone: null,
  linkedin: null,
  kind: 'account',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
});

const mkNode = (
  id: number,
  full_name: string,
  reports_to_contact_id: number | null,
  over: Partial<OrgChartNode> = {},
): OrgChartNode => ({
  ...mkContact(id, full_name, over),
  reports_to_contact_id,
});

const contacts = (): OrgChartContact[] => [
  mkContact(1, 'Ada Lovelace', { title: 'Senior Manager' }),
  mkContact(2, 'Grace Hopper', { title: 'Manager' }),
  mkContact(3, 'Katherine Johnson', { title: 'Engineer' }),
  mkContact(4, 'Margaret Hamilton', { title: 'Architect' }),
  mkContact(5, 'Dorothy Vaughan', { title: 'Director' }),
];

const baseChart = (): OrgChart => ({
  account_id: 7,
  contacts: contacts(),
  nodes: [
    mkNode(1, 'Ada Lovelace', null, { title: 'Senior Manager' }),
    mkNode(2, 'Grace Hopper', 1, { title: 'Manager' }),
    mkNode(3, 'Katherine Johnson', 2, { title: 'Engineer' }),
  ],
  edges: [
    { contact_id: 2, reports_to_contact_id: 1 },
    { contact_id: 3, reports_to_contact_id: 2 },
  ],
  root_contact_ids: [1],
});

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getOrgChart.mockResolvedValue(baseChart());
});

async function setup() {
  const utils = render(() => (
    <MemoryRouter>
      <Route path="*" component={() => <OrgChartPanel accountId={7} />} />
    </MemoryRouter>
  ));
  await screen.findByRole('searchbox', { name: 'Search account contacts' });
  return utils;
}

describe('OrgChartPanel', () => {
  it('renders the explicit chart first without treating unassigned contacts as roots or using a horizontal canvas', async () => {
    const { container } = await setup();
    const panel = container.querySelector('[data-org-chart-panel]')!;
    const chart = container.querySelector('[data-org-chart]')!;
    const index = container.querySelector('[data-contact-index]')!;

    expect(panel.firstElementChild).toBe(chart);
    expect(chart.nextElementSibling).toBe(index);
    expect(chart.querySelector('[data-org-node="1"]')).not.toBeNull();
    expect(chart.querySelector('[data-org-node="2"]')).not.toBeNull();
    expect(chart.querySelector('[data-org-node="3"]')).not.toBeNull();
    expect(chart.querySelector('[data-org-node="4"]')).toBeNull();
    expect(chart.querySelector('[data-org-node="5"]')).toBeNull();
    expect(chart.querySelectorAll('[data-org-edge]')).toHaveLength(2);
    expect(chart.querySelector('[data-org-branch="1"] [data-org-node="2"]')).not.toBeNull();
    expect(chart.querySelector('[data-org-branch="2"] [data-org-node="3"]')).not.toBeNull();
    expect(container.innerHTML).not.toContain('overflow-x-auto');
  });

  it('lists every account contact below and filters only that index', async () => {
    const { container } = await setup();
    expect(container.querySelectorAll('[data-contact-index-row]')).toHaveLength(5);

    fireEvent.input(screen.getByRole('searchbox', { name: 'Search account contacts' }), {
      target: { value: 'architect' },
    });

    expect(container.querySelectorAll('[data-contact-index-row]')).toHaveLength(1);
    expect(container.querySelector('[data-contact-index-row="4"]')).not.toBeNull();
    expect(container.querySelector('[data-org-node="1"]')).not.toBeNull();
    expect(container.querySelector('[data-org-node="3"]')).not.toBeNull();
  });

  it('prevents cycles and blocks removing a manager who still has direct reports', async () => {
    await setup();
    const optionValues = (name: string) => within(screen.getByRole('combobox', { name: `Placement for ${name}` }))
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);

    expect(optionValues('Ada Lovelace')).toEqual(['unassigned', 'root', 'manager:4', 'manager:5']);
    expect(optionValues('Grace Hopper')).toEqual(['unassigned', 'root', 'manager:1', 'manager:4', 'manager:5']);
    expect(optionValues('Katherine Johnson')).toEqual(['unassigned', 'root', 'manager:1', 'manager:2', 'manager:4', 'manager:5']);

    const adaUnassigned = within(screen.getByRole('combobox', { name: 'Placement for Ada Lovelace' }))
      .getByRole('option', { name: /Not in chart/ }) as HTMLOptionElement;
    const katherineUnassigned = within(screen.getByRole('combobox', { name: 'Placement for Katherine Johnson' }))
      .getByRole('option', { name: 'Not in chart' }) as HTMLOptionElement;
    expect(adaUnassigned.disabled).toBe(true);
    expect(katherineUnassigned.disabled).toBe(false);
  });

  it('moves an entire reporting chain when its top manager is placed under a director', async () => {
    const moved = baseChart();
    moved.nodes = [
      mkNode(1, 'Ada Lovelace', 5, { title: 'Senior Manager' }),
      mkNode(2, 'Grace Hopper', 1, { title: 'Manager' }),
      mkNode(3, 'Katherine Johnson', 2, { title: 'Engineer' }),
      mkNode(5, 'Dorothy Vaughan', null, { title: 'Director' }),
    ];
    moved.edges = [
      { contact_id: 1, reports_to_contact_id: 5 },
      { contact_id: 2, reports_to_contact_id: 1 },
      { contact_id: 3, reports_to_contact_id: 2 },
    ];
    moved.root_contact_ids = [5];
    apiMock.setOrgChartManager.mockResolvedValue(moved);

    const { container } = await setup();
    fireEvent.change(screen.getByRole('combobox', { name: 'Placement for Ada Lovelace' }), {
      target: { value: 'manager:5' },
    });

    expect(apiMock.setOrgChartManager).toHaveBeenCalledWith(7, 1, 5);
    await waitFor(() => {
      const directorBranch = container.querySelector('[data-org-branch="5"]');
      expect(directorBranch?.querySelector('[data-org-node="1"]')).not.toBeNull();
      expect(directorBranch?.querySelector('[data-org-node="2"]')).not.toBeNull();
      expect(directorBranch?.querySelector('[data-org-node="3"]')).not.toBeNull();
    });
  });

  it('can remove a leaf from the chart without removing it from the contact index', async () => {
    const removed = baseChart();
    removed.nodes = removed.nodes.filter((node) => node.id !== 3);
    removed.edges = removed.edges.filter((edge) => edge.contact_id !== 3);
    apiMock.removeOrgChartContact.mockResolvedValue(removed);

    const { container } = await setup();
    fireEvent.change(screen.getByRole('combobox', { name: 'Placement for Katherine Johnson' }), {
      target: { value: 'unassigned' },
    });

    expect(apiMock.removeOrgChartContact).toHaveBeenCalledWith(7, 3);
    await waitFor(() => expect(container.querySelector('[data-org-chart] [data-org-node="3"]')).toBeNull());
    expect(container.querySelector('[data-contact-index-row="3"]')).not.toBeNull();
    expect(container.querySelector('[data-contact-placement="3"]')?.textContent).toContain('Not in chart');
  });

  it('shows an empty chart while keeping unassigned contacts available below', async () => {
    const empty = baseChart();
    empty.nodes = [];
    empty.edges = [];
    empty.root_contact_ids = [];
    apiMock.getOrgChart.mockResolvedValue(empty);

    const { container } = await setup();
    expect(screen.getByText('No reporting structure yet. Assign contacts from the index below.')).toBeTruthy();
    expect(container.querySelectorAll('[data-org-node]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-contact-index-row]')).toHaveLength(5);
  });
});
