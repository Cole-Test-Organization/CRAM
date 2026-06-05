import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, patch, del, listFrom, deleteAfter, makeAccount, aCustomerAccount } from './helpers.js';

describe('Threads — lifecycle, tasks, contact pool', () => {
  it('thread CRUD + open/closed lifecycle (closed hidden by default)', async (t) => {
    const acc = await aCustomerAccount();

    const created = await post('/threads', { account_id: acc.id, title: 'zzz-test thread' });
    assert.equal(created.status, 201);
    const id = created.body.id;
    deleteAfter(t, `/threads/${id}`);
    assert.equal(created.body.title, 'zzz-test thread');
    assert.equal(created.body.closed_at, null);
    assert.deepEqual(created.body.tasks, []);
    assert.deepEqual(created.body.contacts, []);

    assert.equal((await get(`/threads/${id}`)).status, 200);

    // open list includes it
    let list = (await get(`/threads?account_id=${acc.id}`)).body;
    assert.ok(list.threads.some((x) => x.id === id), 'open list includes new thread');

    // patch title + description
    const upd = await patch(`/threads/${id}`, { title: 'zzz-test renamed', description: 'ctx' });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.title, 'zzz-test renamed');
    assert.equal(upd.body.description, 'ctx');

    // close → hidden from default list, visible with include_closed
    const closed = await patch(`/threads/${id}`, { closed: true });
    assert.ok(closed.body.closed_at, 'closed_at set on close');
    list = (await get(`/threads?account_id=${acc.id}`)).body;
    assert.ok(!list.threads.some((x) => x.id === id), 'closed thread hidden by default');
    const all = (await get(`/threads?account_id=${acc.id}&include_closed=true`)).body;
    assert.ok(all.threads.some((x) => x.id === id), 'closed thread shown with include_closed=true');

    // reopen clears closed_at
    const reopened = await patch(`/threads/${id}`, { closed: false });
    assert.equal(reopened.body.closed_at, null);

    // delete (idempotent 404 after)
    assert.equal((await del(`/threads/${id}`)).body.deleted, true);
    assert.equal((await get(`/threads/${id}`)).status, 404);
  });

  it('account GET exposes open_thread_count; closing decrements it', async (t) => {
    const { body: acc } = await makeAccount(t);
    assert.equal((await get(`/accounts/${acc.id}`)).body.open_thread_count, 0);

    const th = await post('/threads', { account_id: acc.id, title: 'zzz-test count' });
    deleteAfter(t, `/threads/${th.body.id}`);
    assert.equal((await get(`/accounts/${acc.id}`)).body.open_thread_count, 1, 'open thread counted');

    await patch(`/threads/${th.body.id}`, { closed: true });
    assert.equal((await get(`/accounts/${acc.id}`)).body.open_thread_count, 0, 'closed thread not counted');
  });

  it('tasks: add, assign (name resolves), clear, complete/reopen, delete', async (t) => {
    const acc = await aCustomerAccount();
    const th = await post('/threads', { account_id: acc.id, title: 'zzz-test tasks' });
    deleteAfter(t, `/threads/${th.body.id}`);
    const tid = th.body.id;

    const task = await post(`/threads/${tid}/tasks`, { title: 'zzz send SOW' });
    assert.equal(task.status, 201);
    assert.equal(task.body.completed_at, null);
    assert.equal(task.body.assignee_contact_id, null);
    const taskId = task.body.id;

    // assign to a visible contact — assignee_full_name is resolved in the response
    const contact = listFrom((await get('/contacts?limit=1')).body)[0];
    const assigned = await patch(`/threads/${tid}/tasks/${taskId}`, { assignee_contact_id: contact.id, due_date: '2030-01-15' });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.body.assignee_contact_id, contact.id);
    assert.equal(assigned.body.assignee_full_name, contact.full_name);
    assert.ok(assigned.body.due_date, 'due_date set');

    // clear assignee with null → "no one"
    const cleared = await patch(`/threads/${tid}/tasks/${taskId}`, { assignee_contact_id: null });
    assert.equal(cleared.body.assignee_contact_id, null);
    assert.equal(cleared.body.assignee_full_name, null);

    // complete + reopen
    assert.ok((await patch(`/threads/${tid}/tasks/${taskId}`, { completed: true })).body.completed_at, 'completed_at set');
    assert.equal((await patch(`/threads/${tid}/tasks/${taskId}`, { completed: false })).body.completed_at, null);

    // task is enriched onto the thread
    assert.ok((await get(`/threads/${tid}`)).body.tasks.some((x) => x.id === taskId));

    // delete (idempotent)
    assert.equal((await del(`/threads/${tid}/tasks/${taskId}`)).body.deleted, true);
    assert.equal((await del(`/threads/${tid}/tasks/${taskId}`)).status, 404);
  });

  it('contact pool: link/unlink, surfaced in thread.contacts', async (t) => {
    const acc = await aCustomerAccount();
    const th = await post('/threads', { account_id: acc.id, title: 'zzz-test pool' });
    deleteAfter(t, `/threads/${th.body.id}`);
    const tid = th.body.id;
    const contact = listFrom((await get('/contacts?limit=1')).body)[0];

    const linked = await post(`/threads/${tid}/contacts`, { contact_id: contact.id });
    assert.equal(linked.status, 200);
    assert.ok(linked.body.contacts.some((c) => c.id === contact.id), 'contact added to pool');

    const unlinked = await del(`/threads/${tid}/contacts/${contact.id}`);
    assert.ok(!unlinked.body.contacts.some((c) => c.id === contact.id), 'contact removed from pool');
  });

  it('deleting a thread cascades its tasks', async (t) => {
    const acc = await aCustomerAccount();
    const th = await post('/threads', { account_id: acc.id, title: 'zzz-test cascade' });
    const tid = th.body.id;
    const task = await post(`/threads/${tid}/tasks`, { title: 'zzz child task' });
    assert.equal(task.status, 201);
    assert.equal((await del(`/threads/${tid}`)).body.deleted, true);
    // the task's thread is gone → patching it 404s (row cascaded away)
    assert.equal((await patch(`/threads/${tid}/tasks/${task.body.id}`, { completed: true })).status, 404);
  });

  it('validation: required fields + bad ids', async (t) => {
    const acc = await aCustomerAccount();
    assert.equal((await post('/threads', { account_id: acc.id })).status, 400, 'thread needs a title');
    assert.equal((await get('/threads')).status, 400, 'list needs account_id');
    assert.equal((await get('/threads/999999999')).status, 404, 'unknown thread 404s');

    const th = await post('/threads', { account_id: acc.id, title: 'zzz-test val' });
    deleteAfter(t, `/threads/${th.body.id}`);
    assert.equal((await post(`/threads/${th.body.id}/tasks`, {})).status, 400, 'task needs a title');
    assert.equal((await post(`/threads/${th.body.id}/contacts`, {})).status, 400, 'link needs contact_id');
  });
});
