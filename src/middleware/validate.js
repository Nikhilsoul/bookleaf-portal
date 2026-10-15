const { badRequest } = require('../utils/errors');

/** validate(schema, 'body' | 'query') -> parsed data on req.valid[source]. */
const validate = (schema, source = 'body') => (req, _res, next) => {
  const r = schema.safeParse(source === 'body' ? req.body ?? {} : req.query);
  if (!r.success) {
    const details = r.error.issues.map((i) => ({ field: i.path.join('.') || source, message: i.message }));
    throw badRequest('Validation failed', details);
  }
  req.valid = { ...(req.valid || {}), [source]: r.data };
  next();
};

module.exports = { validate };
