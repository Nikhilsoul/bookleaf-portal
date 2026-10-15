const jwt = require('jsonwebtoken');
const config = require('../config');
const { unauthorized, forbidden } = require('../utils/errors');

const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role, authorId: user.author_id || null, name: user.name }, config.jwtSecret, {
    expiresIn: config.jwtTtl,
  });

function verify(token) {
  try {
    const p = jwt.verify(token, config.jwtSecret);
    return { id: p.sub, role: p.role, author_id: p.authorId, name: p.name };
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}

/** Requires `Authorization: Bearer <jwt>` and populates req.user. */
function authenticate(req, _res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) throw unauthorized();
  req.user = verify(m[1]);
  next();
}

const requireRole = (role) => (req, _res, next) => {
  if (req.user.role !== role) throw forbidden(`This endpoint is restricted to ${role}s`);
  next();
};

module.exports = { signToken, verify, authenticate, requireRole };
