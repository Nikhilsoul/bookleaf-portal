const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const schemas = require('./schemas');
const { validate } = require('../middleware/validate');
const { authenticate, signToken } = require('../middleware/auth');
const { unauthorized } = require('../utils/errors');

// Constant-time-ish: always run a bcrypt compare, even for unknown emails.
const DUMMY = bcrypt.hashSync('not-a-real-password', 10);
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, author_id: u.author_id });

router.post('/login', validate(schemas.login), async (req, res) => {
  const { email, password } = req.valid.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = await bcrypt.compare(password, user?.password_hash || DUMMY);
  if (!user || !ok) throw unauthorized('Incorrect email or password');
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

module.exports = router;
