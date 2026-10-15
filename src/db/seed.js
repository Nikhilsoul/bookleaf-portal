const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./index');
const config = require('../config');

const ADMINS = [
  { email: 'admin@bookleaf.com', name: 'Riya Verma (Ops)' },
  { email: 'ops2@bookleaf.com', name: 'Aman Gupta (Ops)' },
];

// Demo tickets so the queue is not empty on first load; they exercise every category and edge case.
const DEMO_TICKETS = [
  { a: 'AUTH003', b: 'BK005', subject: 'No royalty received since publication', description: "My book Between Two Temples was published in July 2024 and I haven't received any royalty payment at all. It's been over 6 months. What is going on?", hoursAgo: 120 },
  { a: 'AUTH007', b: 'BK011', subject: 'Different ISBN on Amazon vs physical copy', description: 'The ISBN showing on Amazon for The Algorithm of Love is different from the one printed on my physical copy. Readers are confused and one order was matched to the wrong book.', hoursAgo: 30 },
  { a: 'AUTH002', b: 'BK003', subject: 'Royalty amount seems too low', description: 'I sold 876 copies of Code & Karma but my payouts look lower than I expected. Can you explain how royalty is calculated?', hoursAgo: 52 },
  { a: 'AUTH001', b: 'BK001', subject: 'Showing Currently Unavailable on Amazon', description: 'Whispers of the Ganges shows as "Currently Unavailable" on Amazon India since yesterday. It is a live book, please help.', hoursAgo: 8 },
  { a: 'AUTH009', b: 'BK015', subject: 'Still in typesetting after 3 weeks', description: "It's been 3 weeks and Raising Roots is still in typesetting. When will it be done?", hoursAgo: 70 },
  { a: 'AUTH010', b: 'BK018', subject: 'Blurry images in my author copies', description: 'I received my author copies of Howrah Nights and the print quality is terrible. Images are blurry and pages are misaligned.', hoursAgo: 4 },
  { a: 'AUTH004', b: null, subject: 'Can I update my author bio?', description: 'Can I update my author bio on Amazon after the books are already live? I would like to add my new job title.', hoursAgo: 96, reply: 'Hi Vikram,\n\nYes, bio and metadata updates can be submitted through your dashboard or by emailing our team. Changes typically reflect on platforms within 3-5 business days. Send us the new text and we will take it from there.\n\nWarm regards,\nBookLeaf Author Support', status: 'Resolved' },
];

function seed() {
  if (db.prepare('SELECT COUNT(*) n FROM authors').get().n > 0) return false;
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'bookleaf_sample_data.json'), 'utf8'));
  const authorHash = bcrypt.hashSync(config.demo.authorPassword, 10);
  const adminHash = bcrypt.hashSync(config.demo.adminPassword, 10);

  const insAuthor = db.prepare('INSERT INTO authors (id, name, email, phone, city, joined_date) VALUES (?,?,?,?,?,?)');
  const insUser = db.prepare('INSERT INTO users (email, password_hash, role, name, author_id) VALUES (?,?,?,?,?)');
  const insBook = db.prepare(`INSERT INTO books (id, author_id, title, isbn, genre, publication_date, status, mrp, author_royalty_per_copy,
    total_copies_sold, total_royalty_earned, royalty_paid, royalty_pending, last_royalty_payout_date, print_partner, available_on)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  db.transaction(() => {
    for (const a of data.authors) {
      insAuthor.run(a.author_id, a.name, a.email, a.phone, a.city, a.joined_date);
      insUser.run(a.email, authorHash, 'author', a.name, a.author_id);
      for (const b of a.books) {
        insBook.run(b.book_id, a.author_id, b.title, b.isbn, b.genre, b.publication_date, b.status, b.mrp, b.author_royalty_per_copy,
          b.total_copies_sold, b.total_royalty_earned, b.royalty_paid, b.royalty_pending, b.last_royalty_payout_date, b.print_partner, JSON.stringify(b.available_on));
      }
    }
    for (const ad of ADMINS) insUser.run(ad.email, adminHash, 'admin', ad.name, null);
  })();
  return true;
}

/** Demo tickets are created through the real service (rules triage), then back-dated. */
function seedTickets() {
  if (db.prepare('SELECT COUNT(*) n FROM tickets').get().n > 0) return;
  const tickets = require('../services/tickets'); // required lazily to avoid a cycle at module load
  const admin = db.prepare(`SELECT * FROM users WHERE role='admin' ORDER BY id LIMIT 1`).get();
  for (const t of DEMO_TICKETS) {
    const author = db.prepare('SELECT * FROM users WHERE author_id = ?').get(t.a);
    const id = tickets.create({ author_id: t.a, name: author.name }, { book_id: t.b, subject: t.subject, description: t.description });
    const created = new Date(Date.now() - t.hoursAgo * 36e5).toISOString();
    db.prepare('UPDATE tickets SET created_at = ?, updated_at = ? WHERE id = ?').run(created, created, id);
    if (t.reply) { tickets.addAdminReply(id, admin, { body: t.reply, status: t.status }); }
  }
}

module.exports = { seed, seedTickets };
