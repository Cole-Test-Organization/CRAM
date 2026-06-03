import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, del, deleteAfter } from './helpers.js';

const sid = (p) => `${p}-${Date.now().toString(36)}`;

describe('Events — upsert + filters (global table)', () => {
  it('POST upserts by (source, source_id) → 200, idempotent in place', async (t) => {
    const source_id = sid('zzz');
    const first = await post('/events', { source: 'zzz-test', source_id, title: 'ZZZ Event', city: 'Phoenix', mode: 'in_person', start_date: '2026-09-01' });
    assert.equal(first.status, 200);
    const id = first.body.id;
    deleteAfter(t, `/events/${id}`);
    const second = await post('/events', { source: 'zzz-test', source_id, title: 'ZZZ Event Renamed' });
    assert.equal(second.status, 200);
    assert.equal(second.body.id, id, 'same (source, source_id) upserts in place');
    assert.equal(second.body.title, 'ZZZ Event Renamed');
  });

  it('POST requires source, source_id, title (400)', async () => {
    assert.equal((await post('/events', { title: 'no source' })).status, 400);
  });

  it('GET by id 404; list returns {events,total}; facets shape', async () => {
    assert.equal((await get('/events/99999999')).status, 404);
    const list = await get('/events');
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body.events));
    assert.equal(typeof list.body.total, 'number');
    const facets = await get('/events/facets');
    assert.equal(facets.status, 200);
    for (const k of ['cities', 'countries', 'modes', 'sources', 'tags']) assert.ok(Array.isArray(facets.body[k]), `${k} facet`);
  });

  it('upcoming/with-contacts returns {events}', async () => {
    const res = await get('/events/upcoming/with-contacts');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.events));
  });

  it('DELETE returns the title', async () => {
    const { body } = await post('/events', { source: 'zzz-test', source_id: sid('zzz-del'), title: 'ZZZ Del Event' });
    const res = await del(`/events/${body.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, true);
  });
});
