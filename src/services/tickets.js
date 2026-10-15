/** Ticket domain logic: persistence, serialisation, lifecycle and AI triage orchestration. */
const db = require('../db');
const events = require('./events');
const { classifyTicket } = require('./ai/classifier');
const { classifyByRules, applyPolicyFloor } = require('./ai/rules');
const { notFound, conflict, badRequest } = require('../utils/errors');

const now = () => new Date().toISOString();
const PRIORITY_RANK = `CASE t.priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END`;
const UNRESOLVED = `t.status IN ('Open','In Progress')`;
const SLA_HOURS = 48;

const BASE_SELECT = `SELECT t.*, a.name AS author_name, b.title AS book_title, u.name AS assignee_name,
  (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
  FROM tickets t JOIN authors a ON a.id = t.author_id
  LEFT JOIN books b ON b.id = t.book_id LEFT JOIN users u ON u.id = t.assigned_to`;

function decorate(row) {
  const ageHours = Math.floor((Date.now() - new Date(row.created_at)) / 36e5);
  return { ...row, attachments: JSON.parse(row.attachments), age_hours: ageHours,
    sla_breached: ['Open', 'In Progress'].includes(row.status) && ageHours >= SLA_HOURS };
}

/** What authors may see: no priority, AI reasoning, assignee identity, or internal notes. */
function toAuthorView(t) {
  return { id: t.id, subject: t.subject, description: t.description, attachments: t.attachments, book_id: t.book_id,
    book_title: t.book_title, category: t.category, status: t.status, created_at: t.created_at, updated_at: t.updated_at };
}

function getRow(id) {
  const row = db.prepare(`${BASE_SELECT} WHERE t.id = ?`).get(id);
  if (!row) throw notFound('Ticket not found');
  return decorate(row);
}

/** Authors get a 404 (not 403) for other people's tickets so ids can't be probed. */
function getForUser(id, user) {
  const t = getRow(id);
  if (user.role === 'author' && t.author_id !== user.author_id) throw notFound('Ticket not found');
  return t;
}

const getMessages = (id) => db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY id').all(id);
const getNotes = (id) => db.prepare('SELECT * FROM ticket_notes WHERE ticket_id = ? ORDER BY id').all(id);

function create(user, { book_id, subject, description, attachments }) {
  if (book_id) {
    const book = db.prepare('SELECT author_id FROM books WHERE id = ?').get(book_id);
    if (!book || book.author_id !== user.author_id) throw badRequest('Unknown book for this author', [{ field: 'book_id', message: 'Select one of your own books or General / Account Level' }]);
  }
  // Rules classify synchronously so the ticket is immediately sortable; AI refines it afterwards.
  const r = classifyByRules({ subject, description });
  const { priority } = applyPolicyFloor(r.category, r.priority, `${subject} ${description}`);
  const ts = now();
  const info = db.prepare(`INSERT INTO tickets (author_id, book_id, subject, description, attachments, category, priority, ai_reasoning, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(user.author_id, book_id || null, subject, description, JSON.stringify(attachments || []), r.category, priority, r.reasoning, ts, ts);
  const id = Number(info.lastInsertRowid);
  events.emit('ticket:created', { ticketId: id, authorId: user.author_id });
  return id;
}

/** Background AI triage. Never throws; a failure just leaves the rules-based result in place. */
async function runAiTriage(id) {
  try {
    const t = getRow(id);
    const label = t.book_title ? `${t.book_title}` : null;
    const r = await classifyTicket(t, label);
    const fresh = getRow(id); // admin may have overridden while we were waiting
    const sets = ['ai_status = ?', 'updated_at = ?'];
    const args = [r.source === 'ai' ? 'done' : 'fallback', now()];
    if (fresh.category_source !== 'admin') { sets.push('category = ?', 'category_source = ?'); args.push(r.category, r.source); }
    if (fresh.priority_source !== 'admin') { sets.push('priority = ?', 'priority_source = ?'); args.push(r.priority, r.source); }
    sets.push('ai_reasoning = ?'); args.push(r.reasoning);
    db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    if (fresh.category_source !== 'admin' && fresh.category !== r.category) markDraftStale(id);
    events.emit('ticket:updated', { ticketId: id, authorId: t.author_id });
  } catch (e) {
    console.error(`[triage] ticket ${id} failed`, e);
  }
}

function markDraftStale(id) { db.prepare('UPDATE ai_drafts SET stale = 1 WHERE ticket_id = ?').run(id); }

function list(filters, user) {
  const where = []; const args = [];
  if (user.role === 'author') { where.push('t.author_id = ?'); args.push(user.author_id); }
  if (filters.status) { where.push('t.status = ?'); args.push(filters.status); }
  if (filters.category) { where.push('t.category = ?'); args.push(filters.category); }
  if (filters.priority) { where.push('t.priority = ?'); args.push(filters.priority); }
  if (filters.assigned === 'me') { where.push('t.assigned_to = ?'); args.push(user.id); }
  if (filters.assigned === 'unassigned') where.push('t.assigned_to IS NULL');
  if (filters.from) { where.push('t.created_at >= ?'); args.push(filters.from); }
  if (filters.to) { where.push('t.created_at < ?'); args.push(`${filters.to}T23:59:59.999Z`); }
  if (filters.q) { where.push('(t.subject LIKE ? OR t.description LIKE ? OR a.name LIKE ?)'); const q = `%${filters.q}%`; args.push(q, q, q); }
  const order = { newest: 't.created_at DESC', oldest: 't.created_at ASC' }[filters.sort]
    // Default "urgency": unresolved first, then Critical->Low, then oldest first.
    || `CASE WHEN ${UNRESOLVED} THEN 0 ELSE 1 END, ${PRIORITY_RANK}, t.created_at ASC`;
  const sql = `${BASE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${user.role === 'author' ? 't.created_at DESC' : order}`;
  return db.prepare(sql).all(...args).map(decorate);
}

function stats() {
  const one = (sql) => db.prepare(sql).get().n;
  return {
    open: one(`SELECT COUNT(*) n FROM tickets WHERE status = 'Open'`),
    in_progress: one(`SELECT COUNT(*) n FROM tickets WHERE status = 'In Progress'`),
    unassigned: one(`SELECT COUNT(*) n FROM tickets WHERE status IN ('Open','In Progress') AND assigned_to IS NULL`),
    critical_unresolved: one(`SELECT COUNT(*) n FROM tickets WHERE priority = 'Critical' AND status IN ('Open','In Progress')`),
    sla_breached: db.prepare(`SELECT COUNT(*) n FROM tickets WHERE status IN ('Open','In Progress') AND created_at <= ?`).get(new Date(Date.now() - SLA_HOURS * 36e5).toISOString()).n,
  };
}

function update(id, admin, patch) {
  const t = getRow(id);
  const sets = ['updated_at = ?']; const args = [now()];
  if (patch.status) { sets.push('status = ?'); args.push(patch.status); }
  if (patch.category && patch.category !== t.category) { sets.push('category = ?', `category_source = 'admin'`); args.push(patch.category); markDraftStale(id); }
  if (patch.priority && patch.priority !== t.priority) { sets.push('priority = ?', `priority_source = 'admin'`); args.push(patch.priority); }
  if (patch.assigned_to !== undefined) { sets.push('assigned_to = ?'); args.push(patch.assigned_to === 'me' ? admin.id : null); }
  db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  events.emit('ticket:updated', { ticketId: id, authorId: t.author_id });
  return getRow(id);
}

function addAdminReply(id, admin, { body, status, ai_assisted }) {
  const t = getRow(id);
  if (t.status === 'Closed') throw conflict('Ticket is closed. Reopen it before replying.');
  const ts = now();
  db.transaction(() => {
    db.prepare('INSERT INTO ticket_messages (ticket_id, sender_role, sender_name, body, ai_assisted, created_at) VALUES (?,?,?,?,?,?)')
      .run(id, 'admin', 'BookLeaf Support', body, ai_assisted ? 1 : 0, ts);
    const next = status || (t.status === 'Open' ? 'In Progress' : t.status);
    // Replying implies ownership if nobody has picked the ticket up yet.
    db.prepare('UPDATE tickets SET status = ?, assigned_to = COALESCE(assigned_to, ?), updated_at = ? WHERE id = ?').run(next, admin.id, ts, id);
  })();
  events.emit('ticket:message', { ticketId: id, authorId: t.author_id });
  return getRow(id);
}

function addAuthorMessage(id, user, body) {
  const t = getForUser(id, user);
  if (t.status === 'Closed') throw conflict('This ticket is closed. Please submit a new query.');
  const ts = now();
  db.transaction(() => {
    db.prepare('INSERT INTO ticket_messages (ticket_id, sender_role, sender_name, body, created_at) VALUES (?,?,?,?,?)').run(id, 'author', user.name, body, ts);
    // A reply on a resolved ticket reopens it so it reappears in the admin queue.
    db.prepare(`UPDATE tickets SET status = CASE WHEN status = 'Resolved' THEN 'Open' ELSE status END, updated_at = ? WHERE id = ?`).run(ts, id);
    markDraftStale(id);
  })();
  events.emit('ticket:message', { ticketId: id, authorId: t.author_id });
  return getRow(id);
}

function addNote(id, admin, body) {
  const t = getRow(id);
  db.prepare('INSERT INTO ticket_notes (ticket_id, admin_id, admin_name, body, created_at) VALUES (?,?,?,?,?)').run(id, admin.id, admin.name, body, now());
  events.emit('ticket:updated', { ticketId: id, authorId: t.author_id });
  return getNotes(id);
}

module.exports = { create, runAiTriage, list, stats, getRow, getForUser, getMessages, getNotes, update, addAdminReply, addAuthorMessage, addNote, toAuthorView, markDraftStale };
