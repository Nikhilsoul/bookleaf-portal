/** Integration tests: real Express app + in-memory SQLite + a mock Anthropic server. Run: npm test */
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.AI_TIMEOUT_MS = '2000';
process.env.LOGIN_RATE_LIMIT = '1000';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let server, base, mock, mockMode = 'ok', mockCalls = [];

before(async () => {
  mock = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c));
    req.on('end', () => {
      const payload = JSON.parse(body); mockCalls.push(payload);
      if (mockMode === 'down') { res.writeHead(503); return res.end('{}'); }
      const isClassify = payload.system.includes('triage');
      const text = isClassify ? '{"category":"Royalty & Payments","priority":"Critical","reasoning":"No royalty for 6 months"}'
        : 'Hi Ananya,\n\nI am sorry about the wait. You have Rs 2,546 pending.\n\nWarm regards,\nBookLeaf Author Support';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'mock', content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 40 } }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${mock.address().port}/v1/messages`;

  const { seed, seedTickets } = require('../src/db/seed');
  seed(); seedTickets();
  server = require('../src/app').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); mock.close(); });

const call = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email, password) => (await call('/api/auth/login', { method: 'POST', body: { email, password } })).body.token;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('auth: rejects bad credentials and unauthenticated access', async () => {
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'priya.sharma@email.com', password: 'nope' } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'bad' } })).status, 400);
  assert.equal((await call('/api/books')).status, 401);
});

test('authors only see their own books and tickets; admin routes are forbidden', async () => {
  const priya = await login('priya.sharma@email.com', 'Author@123');
  const books = (await call('/api/books', { token: priya })).body.books;
  assert.deepEqual(books.map((b) => b.id).sort(), ['BK001', 'BK002']);
  assert.equal((await call('/api/books/BK003', { token: priya })).status, 404);
  assert.equal((await call('/api/admin/tickets', { token: priya })).status, 403);
  // ticket #2 belongs to Sneha: Priya must get 404
  assert.equal((await call('/api/tickets/2', { token: priya })).status, 404);
});

test('in-production book is returned with null pricing and flagged', async () => {
  const sneha = await login('sneha.kulkarni@email.com', 'Author@123');
  const b = (await call('/api/books', { token: sneha })).body.books.find((x) => x.id === 'BK013');
  assert.equal(b.in_production, true); assert.equal(b.mrp, null);
});

test('ticket validation returns 400 with field details; foreign book rejected', async () => {
  const priya = await login('priya.sharma@email.com', 'Author@123');
  const bad = await call('/api/tickets', { method: 'POST', token: priya, body: { subject: 'x', description: 'short' } });
  assert.equal(bad.status, 400); assert.ok(bad.body.error.details.length >= 2);
  const foreign = await call('/api/tickets', { method: 'POST', token: priya, body: { book_id: 'BK003', subject: 'Hello there', description: 'This is a long enough description.' } });
  assert.equal(foreign.status, 400);
});

test('AI path: ticket created instantly, AI triage applied, draft generated and cached, internal notes hidden', async () => {
  mockMode = 'ok'; mockCalls = [];
  const ananya = await login('ananya.reddy@email.com', 'Author@123');
  const admin = await login('admin@bookleaf.com', 'Admin@123');
  const created = await call('/api/tickets', { method: 'POST', token: ananya, body: { book_id: 'BK005', subject: 'Where is my money', description: 'I have not received royalty for six months after publication.' } });
  assert.equal(created.status, 201);
  await wait(300);
  const id = created.body.ticket.id;
  const detail = (await call(`/api/admin/tickets/${id}`, { token: admin })).body;
  assert.equal(detail.ticket.priority, 'Critical'); assert.equal(detail.ticket.ai_status, 'done');

  const d1 = (await call(`/api/admin/tickets/${id}/draft`, { token: admin })).body.draft;
  const d2 = (await call(`/api/admin/tickets/${id}/draft`, { token: admin })).body.draft;
  assert.equal(d1.source, 'ai'); assert.equal(d2.body, d1.body);
  assert.equal(mockCalls.length, 2, 'one classify + exactly one draft call (second GET served from cache)');
  const draftPrompt = mockCalls[1].messages[0].content;
  assert.ok(draftPrompt.includes('ROYALTY POLICY') && !draftPrompt.includes('PRODUCTION STAGES'), 'only relevant KB section is sent');
  assert.ok(draftPrompt.includes('"royalty_pending":2546'));

  await call(`/api/admin/tickets/${id}/notes`, { method: 'POST', token: admin, body: { body: 'internal only' } });
  await call(`/api/admin/tickets/${id}/reply`, { method: 'POST', token: admin, body: { body: d1.body, ai_assisted: true } });
  const view = (await call(`/api/tickets/${id}`, { token: ananya })).body;
  assert.equal(view.messages.length, 1); assert.ok(!JSON.stringify(view).includes('internal only')); assert.equal(view.ticket.priority, undefined);
});

test('admin override sticks and is not overwritten by AI; patch validation', async () => {
  const admin = await login('admin@bookleaf.com', 'Admin@123');
  const r = await call('/api/admin/tickets/4', { method: 'PATCH', token: admin, body: { priority: 'Low', category: 'General Inquiry', assigned_to: 'me' } });
  assert.equal(r.body.ticket.priority, 'Low'); assert.equal(r.body.ticket.priority_source, 'admin'); assert.ok(r.body.ticket.assigned_to);
  assert.equal((await call('/api/admin/tickets/4', { method: 'PATCH', token: admin, body: { status: 'Bogus' } })).status, 400);
  assert.equal((await call('/api/admin/tickets/9999', { token: admin })).status, 404);
});

test('graceful degradation: AI down -> ticket still created, rules triage, template draft', async () => {
  mockMode = 'down';
  require('../src/services/ai/provider').resetBreaker();
  const kavita = await login('kavita.deshmukh@email.com', 'Author@123');
  const admin = await login('admin@bookleaf.com', 'Admin@123');
  const created = await call('/api/tickets', { method: 'POST', token: kavita, body: { book_id: 'BK016', subject: 'Royalty not received', description: 'My royalty for The Nagpur Notebooks has not arrived yet, please check.' } });
  assert.equal(created.status, 201);
  await wait(2500);
  const id = created.body.ticket.id;
  const t = (await call(`/api/admin/tickets/${id}`, { token: admin })).body.ticket;
  assert.equal(t.ai_status, 'fallback'); assert.equal(t.category, 'Royalty & Payments');
  const d = (await call(`/api/admin/tickets/${id}/draft`, { token: admin })).body.draft;
  assert.equal(d.degraded, true); assert.ok(d.body.includes('below our Rs 1,000'), 'threshold roll-over edge case handled');
  // manual reply still works
  assert.equal((await call(`/api/admin/tickets/${id}/reply`, { method: 'POST', token: admin, body: { body: 'Manual reply' } })).status, 201);
});

test('queue default sort puts unresolved Critical first; filters work', async () => {
  const admin = await login('admin@bookleaf.com', 'Admin@123');
  const all = (await call('/api/admin/tickets', { token: admin })).body.tickets;
  assert.equal(all[0].priority, 'Critical');
  assert.ok(all.at(-1).status === 'Resolved' || all.at(-1).status === 'Closed');
  const f = (await call('/api/admin/tickets?status=Resolved&category=ISBN%20%26%20Metadata%20Issues', { token: admin })).body.tickets;
  assert.ok(f.every((t) => t.status === 'Resolved'));
  assert.equal((await call('/api/admin/tickets?priority=Nope', { token: admin })).status, 400);
});
