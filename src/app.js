const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Render/Railway proxies
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], connectSrc: ["'self'"] } } }));
  app.use(express.json({ limit: '100kb' }));

  const loginLimiter = rateLimit({ windowMs: 60_000, limit: Number(process.env.LOGIN_RATE_LIMIT) || 10, standardHeaders: true, legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again in a minute.' } } });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth/login', loginLimiter);
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/books', require('./routes/books'));
  app.use('/api/tickets', require('./routes/tickets'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/events', require('./routes/events'));
  app.use('/api', notFoundHandler);

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
