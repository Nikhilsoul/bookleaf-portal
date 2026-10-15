/** Admin-only endpoints: queue, ticket management, internal notes, AI drafts and usage. */
const router = require('express').Router();
const schemas = require('./schemas');
const tickets = require('../services/tickets');
const drafter = require('../services/ai/drafter');
const aiUsage = require('../services/ai/usage');
const provider = require('../services/ai/provider');
const config = require('../config');
const { buildContext } = require('../services/context');
const { validate } = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate, requireRole('admin'));

const id = (req) => Number(req.params.id);

router.get('/tickets', validate(schemas.adminList, 'query'), (req, res) => {
  res.json({ tickets: tickets.list(req.valid.query, req.user) });
});

router.get('/stats', (_req, res) => {
  res.json({ stats: tickets.stats(), ai: { configured: provider.isConfigured(), model: config.ai.model, usage: aiUsage.summary() } });
});

router.get('/tickets/:id', (req, res) => {
  const t = tickets.getRow(id(req));
  res.json({ ticket: t, messages: tickets.getMessages(t.id), notes: tickets.getNotes(t.id), context: buildContext(t) });
});

router.patch('/tickets/:id', validate(schemas.patchTicket), (req, res) => {
  res.json({ ticket: tickets.update(id(req), req.user, req.valid.body) });
});

router.post('/tickets/:id/notes', validate(schemas.message), (req, res) => {
  res.status(201).json({ notes: tickets.addNote(id(req), req.user, req.valid.body.body) });
});

router.post('/tickets/:id/reply', validate(schemas.reply), (req, res) => {
  const t = tickets.addAdminReply(id(req), req.user, req.valid.body);
  res.status(201).json({ ticket: t, messages: tickets.getMessages(t.id) });
});

// Draft is cached; GET never costs a call after the first. POST forces regeneration.
router.get('/tickets/:id/draft', async (req, res) => {
  tickets.getRow(id(req));
  res.json({ draft: await drafter.getDraft(id(req)) });
});
router.post('/tickets/:id/draft', async (req, res) => {
  tickets.getRow(id(req));
  res.json({ draft: await drafter.getDraft(id(req), { force: true }) });
});

module.exports = router;
