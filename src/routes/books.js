const router = require('express').Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { notFound } = require('../utils/errors');

const shape = (b) => ({ ...b, available_on: JSON.parse(b.available_on), in_production: !/^Published/i.test(b.status) });

// Authors: their own books. Admins: optionally filter with ?author_id=.
router.get('/', authenticate, (req, res) => {
  const authorId = req.user.role === 'author' ? req.user.author_id : req.query.author_id;
  const rows = authorId
    ? db.prepare('SELECT * FROM books WHERE author_id = ? ORDER BY publication_date IS NULL, publication_date DESC').all(authorId)
    : db.prepare('SELECT * FROM books ORDER BY author_id, id').all();
  res.json({ books: rows.map(shape) });
});

router.get('/:id', authenticate, (req, res) => {
  const b = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!b || (req.user.role === 'author' && b.author_id !== req.user.author_id)) throw notFound('Book not found');
  res.json({ book: shape(b) });
});

module.exports = router;
