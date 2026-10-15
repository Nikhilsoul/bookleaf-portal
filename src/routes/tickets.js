/** Author-facing ticket endpoints. Every query is scoped to the caller's author_id. */
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const schemas = require('./schemas');
const tickets = require('../services/tickets');
const { validate } = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate, requireRole('author'));

const createLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many tickets submitted. Please wait a minute.' } } });

router.get('/', (req, res) => {
  res.json({ tickets: tickets.list({}, req.user).map(tickets.toAuthorView) });
});

router.post('/', createLimiter, validate(schemas.createTicket), (req, res) => {
  const id = tickets.create(req.user, req.valid.body);
  // Respond immediately: ticket creation must never wait on (or fail because of) the AI provider.
  res.status(201).json({ ticket: tickets.toAuthorView(tickets.getRow(id)) });
  setImmediate(() => tickets.runAiTriage(id));
});

router.get('/:id', (req, res) => {
  const t = tickets.getForUser(Number(req.params.id), req.user);
  res.json({ ticket: tickets.toAuthorView(t), messages: tickets.getMessages(t.id) });
});

router.post('/:id/messages', validate(schemas.message), (req, res) => {
  const t = tickets.addAuthorMessage(Number(req.params.id), req.user, req.valid.body.body);
  res.status(201).json({ ticket: tickets.toAuthorView(t), messages: tickets.getMessages(t.id) });
});

module.exports = router;
