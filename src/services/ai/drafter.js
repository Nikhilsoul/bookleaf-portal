const db = require('../../db');
const provider = require('./provider');
const { tracked } = require('./usage');
const { draftSystem, draftUser } = require('./prompts');
const { templateDraft } = require('./rules');
const { buildContext } = require('../context');
const tickets = require('../tickets');

const save = db.prepare(`INSERT INTO ai_drafts (ticket_id, body, source, model, stale, generated_at) VALUES (?,?,?,?,0,?)
  ON CONFLICT(ticket_id) DO UPDATE SET body=excluded.body, source=excluded.source, model=excluded.model, stale=0, generated_at=excluded.generated_at`);

/**
 * Returns a draft reply for the admin. Drafts are cached per ticket (one LLM call per ticket, not per
 * page view) and regenerated only when forced or stale (category override / new author message).
 * If the LLM is down, a template built from the same account facts is returned and flagged `degraded`.
 */
async function getDraft(ticketId, { force = false } = {}) {
  const cached = db.prepare('SELECT * FROM ai_drafts WHERE ticket_id = ?').get(ticketId);
  if (cached && !cached.stale && !force) return shape(cached, null);

  const ticket = tickets.getRow(ticketId);
  const ctx = buildContext(ticket);
  const thread = tickets.getMessages(ticketId);
  try {
    const out = await tracked('draft', ticketId, () =>
      provider.complete({ system: draftSystem(), user: draftUser({ category: ticket.category, ctx, ticket, thread }), maxTokens: 450 })
    );
    save.run(ticketId, out.text, 'ai', out.model, new Date().toISOString());
    return shape(db.prepare('SELECT * FROM ai_drafts WHERE ticket_id = ?').get(ticketId), null);
  } catch (e) {
    console.warn(`[ai] draft fallback for ticket ${ticketId}: ${e.message}`);
    save.run(ticketId, templateDraft(ticket.category, ctx), 'template', null, new Date().toISOString());
    return shape(db.prepare('SELECT * FROM ai_drafts WHERE ticket_id = ?').get(ticketId), 'AI is currently unavailable. This is a template filled from the author\'s account data; review before sending.');
  }
}

const shape = (d, degradedReason) => ({
  body: d.body, source: d.source, model: d.model, generated_at: d.generated_at,
  degraded: d.source === 'template', reason: degradedReason || (d.source === 'template' ? 'Template draft (AI was unavailable when generated). Use "Regenerate" to retry.' : null),
});

module.exports = { getDraft };
