const router = require('express').Router();
const { verify } = require('../middleware/auth');
const { unauthorized } = require('../utils/errors');
const events = require('../services/events');

// EventSource cannot set headers, so the JWT is accepted as ?token= on this one route.
router.get('/', (req, res) => {
  if (!req.query.token) throw unauthorized();
  const user = verify(String(req.query.token));
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  events.addClient(res, user);
});

module.exports = router;
