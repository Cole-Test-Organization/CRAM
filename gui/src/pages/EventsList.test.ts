import { describe, expect, it } from 'vitest';
import { filterAndSortEvents } from './EventsList';

const BASE_FILTERS = {
  view: 'all' as const,
  search: '',
  mode: '',
  city: '',
  country: '',
  tags: '',
  has_location: false,
  after: '',
  before: '',
  sort: 'start_date',
  order: 'asc' as const,
};

const EVENTS = [
  { id: 1, title: 'Cloud Summit', summary: 'Security', start_date: '2026-07-18', mode: 'in_person', city: 'Seattle', country: 'US', tags: ['cloud'] },
  { id: 2, title: 'Virtual Briefing', summary: 'Network update', start_date: '2026-07-17', mode: 'virtual', city: null, country: 'US', tags: ['network'] },
  { id: 3, title: 'Undated Roadshow', summary: 'Security', start_date: null, mode: 'in_person', city: 'Portland', country: 'US', tags: ['cloud'] },
];

describe('offline event filtering', () => {
  it('applies the server list semantics locally against one stable snapshot', () => {
    const result = filterAndSortEvents(EVENTS, {
      ...BASE_FILTERS,
      search: 'security',
      tags: 'cloud',
      after: '2026-07-18',
    });

    // The API deliberately retains undated rows when an after/before filter is
    // present; the offline filter mirrors that behavior.
    expect(result.map((event) => event.id)).toEqual([1, 3]);
  });

  it('keeps travel-planner filtering to mode/date and ignores hidden list filters', () => {
    const result = filterAndSortEvents(EVENTS, {
      ...BASE_FILTERS,
      view: 'with_contacts',
      mode: 'in_person',
      city: 'Nowhere',
      search: 'does-not-match',
    });

    expect(result.map((event) => event.id)).toEqual([1, 3]);
  });
});
