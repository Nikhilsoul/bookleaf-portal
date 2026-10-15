// Vanilla ES-module SPA (no build step). All text goes through textContent/createTextNode, so user content can't inject HTML.
const CATEGORIES = ['Royalty & Payments', 'ISBN & Metadata Issues', 'Printing & Quality', 'Distribution & Availability', 'Book Status & Production Updates', 'General Inquiry'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];

const $app = document.getElementById('app');
const state = { token: localStorage.getItem('bl_token'), user: JSON.parse(localStorage.getItem('bl_user') || 'null'), onLive: null, es: null };

/* ---------- helpers ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
const select = (opts, value, attrs = {}) => {
  const s = h('select', attrs, opts.map((o) => (Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o))));
  s.value = value ?? ''; return s;
};
const inr = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);
const fmtId = (id) => `BL-${String(id).padStart(4, '0')}`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');
const age = (hrs) => (hrs >= 48 ? `${Math.floor(hrs / 24)}d` : `${hrs}h`);
const chip = (cls, text) => h('span', { class: `chip ${cls}` }, text);
const statusChip = (s) => chip(`s-${s}`, s);
const prioChip = (p) => chip(`p-${p}`, p);
const srcTag = (src) => h('span', { class: `src ${src === 'admin' ? 'admin' : ''}`, title: 'Who set this value' }, src === 'admin' ? 'admin override' : src === 'ai' ? 'AI' : 'rules');

function toast(msg, bad) {
  const t = h('div', { class: `toast ${bad ? 'bad' : ''}` }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), 4500);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, { method, headers: { 'content-type': 'application/json', ...(state.token && { authorization: `Bearer ${state.token}` }) }, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.token) { logout(); }
    const e = new Error(data.error?.message || 'Request failed'); e.details = data.error?.details; throw e;
  }
  return data;
}
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };

/* ---------- auth + live updates ---------- */
function setSession(token, user) {
  state.token = token; state.user = user;
  localStorage.setItem('bl_token', token); localStorage.setItem('bl_user', JSON.stringify(user));
}
function logout() {
  state.token = null; state.user = null; state.es?.close(); state.es = null;
  localStorage.removeItem('bl_token'); localStorage.removeItem('bl_user');
  location.hash = ''; render();
}
function connectLive() {
  state.es?.close();
  const es = new EventSource(`/api/events?token=${encodeURIComponent(state.token)}`);
  let timer;
  for (const ev of ['ticket:created', 'ticket:updated', 'ticket:message']) {
    es.addEventListener(ev, (e) => {
      const d = JSON.parse(e.data);
      if (state.user.role === 'admin' && ev === 'ticket:created') toast(`New ticket ${fmtId(d.ticketId)}`);
      if (state.user.role === 'author' && ev === 'ticket:message') toast(`New reply on ${fmtId(d.ticketId)}`);
      clearTimeout(timer); timer = setTimeout(() => state.onLive?.(ev, d), 150); // coalesce bursts
    });
  }
  state.es = es;
}

/* ---------- layout + router ---------- */
function shell(content) {
  const authorNav = [['#/books', 'My Books'], ['#/new', 'Submit a Query'], ['#/tickets', 'My Tickets']];
  const adminNav = [['#/admin', 'Ticket Queue']];
  const nav = (state.user.role === 'admin' ? adminNav : authorNav);
  const cur = location.hash;
  $app.replaceChildren(
    h('header', { class: 'top' },
      h('span', { class: 'brand' }, 'BookLeaf', state.user.role === 'admin' ? ' Ops' : ' Author Support'),
      h('nav', {}, nav.map(([href, label]) => h('a', { href, class: cur.startsWith(href) && (href !== '#/tickets' || !cur.startsWith('#/new')) ? 'on' : '' }, label))),
      h('span', { class: 'who' }, state.user.name, h('button', { class: 'link', onclick: logout }, 'Sign out'))),
    h('main', {}, content));
}

async function render() {
  state.onLive = null;
  if (!state.token) return loginView();
  if (!state.es) connectLive();
  const hash = location.hash || (state.user.role === 'admin' ? '#/admin' : '#/books');
  const adminRoute = hash.startsWith('#/admin');
  if ((state.user.role === 'admin') !== adminRoute) { location.hash = state.user.role === 'admin' ? '#/admin' : '#/books'; return; }
  const parts = hash.split('/'); // ['#','tickets','12']
  try {
    if (hash === '#/books') return await booksView();
    if (hash === '#/new') return newTicketView();
    if (hash === '#/tickets') return await ticketsView();
    if (parts[1] === 'tickets' && parts[2]) return await authorTicketView(Number(parts[2]));
    if (hash === '#/admin') return await queueView();
    if (parts[1] === 'admin' && parts[2] === 'tickets') return await adminTicketView(Number(parts[3]));
    location.hash = state.user.role === 'admin' ? '#/admin' : '#/books';
  } catch (e) { shell(h('div', { class: 'card empty' }, h('h2', {}, 'Something went wrong'), e.message, h('p', {}, h('a', { href: '#/' }, 'Back to start')))); }
}
window.addEventListener('hashchange', render);

/* ---------- login ---------- */
function loginView() {
  const err = h('div', { class: 'err' });
  const email = h('input', { type: 'email', required: true, autocomplete: 'username' });
  const pass = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      try { const r = await api('/auth/login', { method: 'POST', body: { email: email.value, password: pass.value } }); setSession(r.token, r.user); location.hash = ''; render(); }
      catch (x) { err.textContent = x.message; }
    },
  }, h('div', { class: 'field' }, h('label', {}, 'Email'), email), h('div', { class: 'field' }, h('label', {}, 'Password'), pass), err, h('button', { type: 'submit' }, 'Sign in'));
  const fill = (e, p) => h('button', { type: 'button', class: 'ghost', onclick: () => { email.value = e; pass.value = p; } }, e);
  $app.replaceChildren(h('div', { class: 'login' }, h('h1', {}, 'BookLeaf'), h('p', { class: 'muted' }, 'Sign in to your author or operations account.'), h('div', { class: 'card' }, form),
    h('div', { class: 'demo' }, h('b', {}, 'Demo accounts'), h('div', { class: 'small' }, 'Authors: password ', h('code', {}, 'Author@123'), ' · Admins: ', h('code', {}, 'Admin@123')),
      h('div', { class: 'row' }, fill('priya.sharma@email.com', 'Author@123'), fill('admin@bookleaf.com', 'Admin@123')))));
}

/* ---------- author: books ---------- */
async function booksView() {
  const { books } = await api('/books');
  const sum = (k) => books.reduce((a, b) => a + (b[k] || 0), 0);
  const content = [h('h1', {}, 'My Books')];
  if (!books.length) content.push(h('div', { class: 'card empty' }, 'No books on your account yet.'));
  else {
    content.push(h('div', { class: 'sum' }, [['Total royalty earned', sum('total_royalty_earned')], ['Royalty paid', sum('royalty_paid')], ['Royalty pending', sum('royalty_pending')]].map(([l, v]) => h('div', { class: 'stat' }, l, h('b', {}, inr(v))))));
    const rows = books.map((b) => {
      const note = b.in_production ? 'Pricing and royalties appear once your book is published.'
        : b.royalty_pending > 0 && b.royalty_pending < 1000 ? 'Below the ₹1,000 minimum, so it rolls over to next quarter.'
        : b.royalty_pending > 0 && !b.last_royalty_payout_date ? 'No payout made yet.' : '';
      return h('tr', { class: b.in_production ? 'done' : '' },
        h('td', {}, h('b', {}, b.title), h('div', { class: 'small muted' }, b.available_on.length ? `On ${b.available_on.join(', ')}` : 'Not listed yet')),
        h('td', {}, b.isbn || '—'), h('td', {}, b.genre), h('td', {}, fmtDay(b.publication_date)),
        h('td', {}, chip(b.in_production ? 's-In Progress' : 's-Resolved', b.status)),
        h('td', { class: 'num' }, inr(b.mrp)), h('td', { class: 'num' }, b.total_copies_sold.toLocaleString('en-IN')),
        h('td', { class: 'num' }, inr(b.in_production ? null : b.total_royalty_earned)), h('td', { class: 'num' }, inr(b.in_production ? null : b.royalty_paid)),
        h('td', { class: 'num' }, inr(b.in_production ? null : b.royalty_pending), note && h('div', { class: 'small muted' }, note)));
    });
    content.push(h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Title', 'ISBN', 'Genre', 'Published', 'Status', 'MRP', 'Copies sold', 'Royalty earned', 'Royalty paid', 'Royalty pending'].map((c, i) => h('th', { class: i > 4 ? 'num' : '' }, c)))), h('tbody', {}, rows))));
  }
  shell(content);
}

/* ---------- author: new ticket ---------- */
async function newTicketView() {
  const { books } = await api('/books');
  const book = select([['', 'General / Account Level'], ...books.map((b) => [b.id, b.title])], '');
  const subject = h('input', { maxLength: 150, required: true, placeholder: 'e.g. Royalty for Q3 not received' });
  const desc = h('textarea', { required: true, placeholder: 'Describe the issue: what happened, when, and what you expected. Include any numbers or dates.' });
  const files = h('input', { type: 'file', multiple: true });
  const errs = h('div', { class: 'err' });
  const submit = h('button', { type: 'submit' }, 'Submit query');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault(); errs.textContent = ''; submit.disabled = true;
      try {
        const attachments = [...files.files].map((f) => ({ name: f.name, size: f.size }));
        const r = await api('/tickets', { method: 'POST', body: { book_id: book.value || null, subject: subject.value, description: desc.value, attachments } });
        toast(`Ticket ${fmtId(r.ticket.id)} submitted`); location.hash = `#/tickets/${r.ticket.id}`;
      } catch (x) { errs.textContent = [x.message, ...(x.details || []).map((d) => `${d.field}: ${d.message}`)].join(' · '); submit.disabled = false; }
    },
  }, h('div', { class: 'field' }, h('label', {}, 'Which book is this about?'), book), h('div', { class: 'field' }, h('label', {}, 'Subject'), subject),
    h('div', { class: 'field' }, h('label', {}, 'Details'), desc), h('div', { class: 'field' }, h('label', {}, 'Attachments (optional)'), files,
      h('div', { class: 'small muted' }, 'Photos or screenshots help. File names are recorded with your ticket; file storage is not enabled yet, so reply with files if we ask.')), errs, submit);
  shell([h('h1', {}, 'Submit a Support Query'), h('div', { class: 'card', style: 'max-width:720px' }, form)]);
}

/* ---------- author: tickets ---------- */
async function ticketsView() {
  const box = h('div', { class: 'stack' });
  const load = async () => {
    const { tickets } = await api('/tickets');
    box.replaceChildren(...(tickets.length ? tickets.map((t) => h('a', { href: `#/tickets/${t.id}`, style: 'text-decoration:none;color:inherit;display:block' },
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, `${fmtId(t.id)}  ${t.subject}`), statusChip(t.status)),
        h('div', { class: 'small muted' }, `${t.book_title || 'General / Account Level'} · ${fmtDate(t.created_at)}`))))
      : [h('div', { class: 'card empty' }, h('p', {}, 'You have not submitted any queries yet.'), h('a', { href: '#/new' }, 'Submit your first query'))]));
  };
  shell([h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'My Tickets'), h('a', { href: '#/new' }, 'New query')), box]);
  await load(); state.onLive = guard(load);
}

function thread(messages) {
  return messages.map((m) => h('div', { class: `msg ${m.sender_role}` }, h('div', { class: 'who' }, h('b', {}, m.sender_role === 'admin' ? 'BookLeaf Support' : 'You'), fmtDate(m.created_at)), h('div', { class: 'body' }, m.body)));
}

async function authorTicketView(id) {
  const head = h('div'), msgs = h('div', { class: 'stack' }), compose = h('div');
  const load = async () => {
    const { ticket: t, messages } = await api(`/tickets/${id}`);
    head.replaceChildren(h('a', { href: '#/tickets' }, '← All tickets'), h('div', { class: 'row', style: 'margin-top:.5rem' }, h('h1', { class: 'grow' }, `${fmtId(t.id)}  ${t.subject}`), statusChip(t.status)),
      h('div', { class: 'small muted' }, `${t.book_title || 'General / Account Level'} · ${t.category} · submitted ${fmtDate(t.created_at)}`),
      t.attachments.length ? h('div', { class: 'small muted' }, `Attachments noted: ${t.attachments.map((a) => a.name).join(', ')}`) : null);
    msgs.replaceChildren(h('div', { class: 'msg' }, h('div', { class: 'who' }, h('b', {}, 'Your query'), fmtDate(t.created_at)), h('div', { class: 'body' }, t.description)), ...thread(messages),
      messages.length === 0 ? h('div', { class: 'muted small' }, 'Our team has your query. You will see their reply here as soon as it is sent; no need to refresh.') : null);
    if (!compose.firstChild && t.status !== 'Closed') {
      const ta = h('textarea', { placeholder: 'Add a follow-up' });
      compose.append(h('div', { class: 'field' }, h('label', {}, 'Reply'), ta), h('button', { onclick: guard(async () => { if (!ta.value.trim()) return; await api(`/tickets/${id}/messages`, { method: 'POST', body: { body: ta.value } }); ta.value = ''; await load(); }) }, 'Send reply'));
    }
    if (t.status === 'Closed') compose.replaceChildren(h('div', { class: 'muted small' }, 'This ticket is closed. Submit a new query if you need more help.'));
  };
  shell([head, h('div', { class: 'stack', style: 'margin-top:1rem' }, msgs, compose)]);
  await load(); state.onLive = guard((_e, d) => (d.ticketId === id ? load() : null));
}

/* ---------- admin: queue ---------- */
const filt = { status: '', category: '', priority: '', assigned: '', q: '', from: '', to: '', sort: 'urgency' };
async function queueView() {
  const statsBox = h('div', { class: 'stats' }), tbody = h('tbody'), count = h('span', { class: 'muted small' });
  const reload = guard(async () => {
    const qs = new URLSearchParams(Object.entries(filt).filter(([, v]) => v)).toString();
    const [{ tickets }, { stats, ai }] = await Promise.all([api(`/admin/tickets?${qs}`), api('/admin/stats')]);
    statsBox.replaceChildren(...[['Open', stats.open], ['In progress', stats.in_progress], ['Unassigned', stats.unassigned], ['Critical unresolved', stats.critical_unresolved, 1], ['Waiting 48h+', stats.sla_breached, 1]]
      .map(([l, v, hot]) => h('div', { class: `stat ${hot && v ? 'hot' : ''}` }, l, h('b', {}, v))), h('div', { class: 'stat' }, 'AI triage', h('b', { style: 'font-size:1rem' }, ai.configured ? `On · ${ai.model}` : 'Off · rules fallback')));
    count.textContent = `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`;
    tbody.replaceChildren(...(tickets.length ? tickets.map((t) => h('tr', { class: `click ${t.sla_breached ? 'breach' : ''} ${['Resolved', 'Closed'].includes(t.status) ? 'done' : ''}`, tabindex: 0, onclick: () => (location.hash = `#/admin/tickets/${t.id}`), onkeydown: (e) => e.key === 'Enter' && (location.hash = `#/admin/tickets/${t.id}`) },
      h('td', {}, fmtId(t.id)), h('td', {}, h('b', {}, t.subject), h('div', { class: 'small muted' }, t.book_title || 'General / Account Level')), h('td', {}, t.author_name),
      h('td', {}, t.category, srcTag(t.category_source)), h('td', {}, prioChip(t.priority), srcTag(t.priority_source)), h('td', {}, statusChip(t.status)),
      h('td', {}, t.assignee_name || h('span', { class: 'muted' }, 'Unassigned')), h('td', { class: t.sla_breached ? 'err' : '' }, age(t.age_hours))))
      : [h('tr', {}, h('td', { colspan: 8, class: 'empty' }, 'No tickets match these filters.'))]));
  });
  const bind = (key, el) => { el.value = filt[key]; el.addEventListener('input', () => { filt[key] = el.value; reload(); }); return el; };
  const f = (label, el) => h('div', {}, h('label', {}, label), el);
  const any = (arr) => [['', 'All'], ...arr.map((x) => [x, x])];
  shell([h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Ticket Queue'), count), statsBox,
    h('div', { class: 'filters' },
      f('Status', bind('status', select(any(STATUSES)))), f('Category', bind('category', select(any(CATEGORIES)))), f('Priority', bind('priority', select(any(PRIORITIES)))),
      f('Assignee', bind('assigned', select([['', 'Anyone'], ['me', 'Assigned to me'], ['unassigned', 'Unassigned']]))), f('From', bind('from', h('input', { type: 'date' }))), f('To', bind('to', h('input', { type: 'date' }))),
      f('Search', bind('q', h('input', { type: 'search', placeholder: 'Subject, text, author' }))), f('Sort', bind('sort', select([['urgency', 'Most urgent first'], ['oldest', 'Oldest first'], ['newest', 'Newest first']])))),
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Ticket', 'Subject', 'Author', 'Category', 'Priority', 'Status', 'Assignee', 'Age'].map((c) => h('th', {}, c)))), tbody))]);
  await reload(); state.onLive = reload;
}

/* ---------- admin: ticket detail ---------- */
async function adminTicketView(id) {
  let data, draft = null, dirty = false;
  const threadBox = h('div', { class: 'stack' }), metaBox = h('div', { class: 'card stack' }), ctxBox = h('div', { class: 'card' }), notesBox = h('div', { class: 'card' }), composer = h('div', { class: 'card' });
  const headBox = h('div');

  const patch = guard(async (body) => { await api(`/admin/tickets/${id}`, { method: 'PATCH', body }); await load(); if (body.category) { dirty = false; await loadDraft(); } });

  function renderAll() {
    const t = data.ticket;
    headBox.replaceChildren(h('a', { href: '#/admin' }, '← Queue'), h('div', { class: 'row', style: 'margin-top:.5rem' }, h('h1', { class: 'grow' }, `${fmtId(t.id)}  ${t.subject}`), prioChip(t.priority), statusChip(t.status)),
      h('div', { class: 'small muted' }, `${t.author_name} · ${t.book_title || 'General / Account Level'} · ${fmtDate(t.created_at)} · waiting ${age(t.age_hours)}`));
    threadBox.replaceChildren(h('div', { class: 'msg' }, h('div', { class: 'who' }, h('b', {}, t.author_name), fmtDate(t.created_at)), h('div', { class: 'body' }, t.description),
      t.attachments.length ? h('div', { class: 'small muted' }, `Attachments noted: ${t.attachments.map((a) => a.name).join(', ')}`) : null),
      ...data.messages.map((m) => h('div', { class: `msg ${m.sender_role}` }, h('div', { class: 'who' }, h('b', {}, m.sender_role === 'admin' ? `BookLeaf Support${m.ai_assisted ? ' (AI-assisted)' : ''}` : t.author_name), fmtDate(m.created_at)), h('div', { class: 'body' }, m.body))));

    const status = select(STATUSES, t.status, { onchange: () => patch({ status: status.value }) });
    const cat = select(CATEGORIES, t.category, { onchange: () => patch({ category: cat.value }) });
    const pri = select(PRIORITIES, t.priority, { onchange: () => patch({ priority: pri.value }) });
    metaBox.replaceChildren(h('h3', {}, 'Ticket'),
      h('div', {}, h('label', {}, 'Status'), status),
      h('div', {}, h('label', {}, 'Category ', srcTag(t.category_source)), cat),
      h('div', {}, h('label', {}, 'Priority ', srcTag(t.priority_source)), pri),
      t.ai_reasoning ? h('div', { class: 'small muted' }, `Why: ${t.ai_reasoning}`) : null,
      t.ai_status === 'pending' ? h('div', { class: 'small muted' }, 'AI triage running…') : null,
      h('div', { class: 'row' }, h('span', { class: 'grow' }, t.assignee_name ? `Assigned to ${t.assignee_name}` : 'Unassigned'),
        t.assigned_to === state.user.id ? h('button', { class: 'ghost', onclick: () => patch({ assigned_to: null }) }, 'Unassign') : h('button', { class: 'ghost', onclick: () => patch({ assigned_to: 'me' }) }, 'Assign to me')));

    const c = data.context; const facts = [];
    const dl = (rows) => h('dl', {}, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    facts.push(dl([['Payout cycle due by', fmtDay(c.payout_schedule.payout_due_by)], ['Author since', fmtDay(c.author.joined)]]));
    const bookDl = (b) => dl([['Status', b.status], ['Copies sold', b.copies_sold ?? '—'], ['Earned', inr(b.royalty_earned)], ['Paid', inr(b.royalty_paid)], ['Pending', inr(b.royalty_pending)], ['Last payout', fmtDay(b.last_payout_date)], ['Printer', b.print_partner || '—'], ['Flags', b.flags?.join(', ') || 'none']]);
    if (c.book) facts.push(h('h3', { style: 'margin-top:.75rem' }, c.book.title), bookDl(c.book));
    else (c.books || []).forEach((b) => facts.push(h('h3', { style: 'margin-top:.75rem' }, b.title), dl([['Status', b.status], ['Paid', inr(b.paid)], ['Pending', inr(b.pending)], ['Flags', b.flags.join(', ') || 'none']])));
    ctxBox.replaceChildren(h('h3', {}, 'Account facts (also sent to AI)'), ...facts);

    const ta = h('textarea', { placeholder: 'Write a note for your team (never shown to the author)' });
    notesBox.replaceChildren(h('h3', {}, 'Internal notes'), ...data.notes.map((n) => h('div', { class: 'note' }, h('b', {}, n.admin_name), ` · ${fmtDate(n.created_at)}`, h('div', {}, n.body))), ta,
      h('button', { class: 'ghost', style: 'margin-top:.5rem', onclick: guard(async () => { if (!ta.value.trim()) return; await api(`/admin/tickets/${id}/notes`, { method: 'POST', body: { body: ta.value } }); await load(); }) }, 'Add note'));
  }

  const load = async () => { data = await api(`/admin/tickets/${id}`); renderAll(); renderComposer(); };

  const ta = h('textarea', { style: 'min-height:220px', oninput: () => (dirty = true), placeholder: 'Write your reply to the author' });
  const banner = h('div'); const statusSel = select(STATUSES, 'In Progress'); const sendBtn = h('button', {}, 'Send reply'); const regen = h('button', { class: 'ghost' }, 'Regenerate draft');
  function renderComposer() {
    if (data.ticket.status === 'Closed') { composer.replaceChildren(h('div', { class: 'muted' }, 'This ticket is closed. Change its status above to reply.')); return; }
    if (!composer.contains(ta)) composer.replaceChildren(h('h3', {}, 'Reply to author'), banner, ta, h('div', { class: 'row', style: 'margin-top:.6rem' }, h('label', { style: 'margin:0' }, 'Then set status'), statusSel, h('span', { class: 'grow' }), regen, sendBtn));
  }
  async function loadDraft(force) {
    banner.replaceChildren(h('div', { class: 'banner ai' }, force ? 'Regenerating draft…' : 'Preparing an AI draft from the knowledge base and account facts…'));
    try {
      const r = await api(`/admin/tickets/${id}/draft`, { method: force ? 'POST' : 'GET' });
      draft = r.draft; ta.value = draft.body; dirty = false;
      banner.replaceChildren(draft.degraded ? h('div', { class: 'banner' }, draft.reason) : h('div', { class: 'banner ai' }, `AI draft${draft.model ? ` (${draft.model})` : ''}. Review and edit before sending.`));
    } catch (e) { banner.replaceChildren(h('div', { class: 'banner' }, 'Could not load a draft. Write your reply manually.')); }
  }
  regen.onclick = () => { if (!dirty || confirm('Replace your edits with a fresh draft?')) loadDraft(true); };
  sendBtn.onclick = guard(async () => {
    if (!ta.value.trim()) return toast('Write a reply first', true);
    sendBtn.disabled = true;
    try { await api(`/admin/tickets/${id}/reply`, { method: 'POST', body: { body: ta.value, status: statusSel.value, ai_assisted: draft?.source === 'ai' } }); toast('Reply sent'); dirty = false; ta.value = ''; await load(); await loadDraft(); }
    finally { sendBtn.disabled = false; }
  });

  shell([headBox, h('div', { class: 'split', style: 'margin-top:1rem' }, h('div', { class: 'stack' }, threadBox, composer), h('aside', { class: 'stack' }, metaBox, ctxBox, notesBox))]);
  await load();
  if (data.ticket.status !== 'Closed') { statusSel.value = data.ticket.status === 'Open' ? 'In Progress' : data.ticket.status; await loadDraft(); }
  state.onLive = guard(async (ev, d) => {
    if (d.ticketId !== id) return;
    await load();
    if (ev === 'ticket:message') { if (!dirty) await loadDraft(); else toast('The author replied. Use "Regenerate draft" for an updated draft.'); }
  });
}

render();
