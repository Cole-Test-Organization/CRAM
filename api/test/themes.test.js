import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, patch, del, listFrom, deleteAfter } from './helpers.js';

const ramp = () => Array(11).fill('#101010');
const themeData = () => ({ colors: { surf: ramp(), cerulean: ramp(), amber: ramp(), papaya: ramp(), scarlet: ramp(), base: ramp() } });

describe('Themes — built-ins + user CRUD', () => {
  it('lists the 5 built-ins; GET active returns a theme', async () => {
    const themes = listFrom((await get('/themes')).body);
    assert.ok(themes.filter((t) => t.is_builtin).length >= 5, 'five built-in themes');
    const active = await get('/themes/active');
    assert.equal(active.status, 200);
    assert.ok(active.body.theme);
  });

  it('create a user theme (200), GET it, set it active, then clear active', async (t) => {
    const slug = `zzz-theme-${Date.now().toString(36)}`;
    const created = await post('/themes', { slug, name: 'ZZZ Theme', theme_data: themeData() });
    assert.equal(created.status, 200);
    const id = created.body.id;
    deleteAfter(t, `/themes/${id}`);
    assert.equal((await get(`/themes/${id}`)).status, 200);
    assert.equal((await post('/themes/active', { theme_id: id })).status, 200);
    await post('/themes/active', { theme_id: null }); // don't leave a dangling pointer
  });

  it('built-in themes are read-only (PATCH / DELETE rejected)', async () => {
    const builtin = listFrom((await get('/themes')).body).find((t) => t.is_builtin);
    assert.ok((await patch(`/themes/${builtin.id}`, { name: 'Hacked' })).status >= 400);
    assert.ok((await del(`/themes/${builtin.id}`)).status >= 400);
  });
});
