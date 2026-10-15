/**
 * Builds the compact "account facts" sent to the LLM (and used by template drafts).
 * Facts are computed here in code (payout dates, threshold flags) rather than left to the model,
 * which keeps numbers accurate and the prompt small.
 */
const db = require('../db');

const DAY = 864e5;
const iso = (d) => d.toISOString().slice(0, 10);
const quarterEnd = (y, q) => new Date(Date.UTC(y, (q + 1) * 3, 0));

/** Royalties are paid within 45 days of quarter end. Returns the cycle currently awaiting payout. */
function payoutSchedule(today = new Date()) {
  const y = today.getUTCFullYear();
  const q = Math.floor(today.getUTCMonth() / 3);
  const prevEnd = q === 0 ? quarterEnd(y - 1, 3) : quarterEnd(y, q - 1);
  const prevDue = new Date(prevEnd.getTime() + 45 * DAY);
  const end = today <= prevDue ? prevEnd : quarterEnd(y, q);
  return { quarter_end: iso(end), payout_due_by: iso(new Date(end.getTime() + 45 * DAY)), today: iso(today) };
}

function bookFacts(b) {
  const inProduction = !/^Published/i.test(b.status);
  const flags = [];
  if (inProduction) flags.push('in_production_no_sales_or_royalty_yet');
  else {
    if (b.royalty_paid === 0 && b.royalty_pending > 0) flags.push('never_paid_out_yet');
    if (b.royalty_pending > 0 && b.royalty_pending < 1000) flags.push('pending_below_rs1000_threshold_rolls_over');
    if (b.royalty_pending === 0 && b.royalty_paid > 0) flags.push('fully_paid');
    if (b.royalty_pending >= 1000 && b.last_royalty_payout_date === null) flags.push('pending_above_threshold_and_no_payout_ever_made');
  }
  return {
    title: b.title, status: b.status, isbn: b.isbn, publication_date: b.publication_date,
    mrp: b.mrp, royalty_per_copy: b.author_royalty_per_copy, copies_sold: b.total_copies_sold,
    royalty_earned: b.total_royalty_earned, royalty_paid: b.royalty_paid, royalty_pending: b.royalty_pending,
    last_payout_date: b.last_royalty_payout_date, print_partner: b.print_partner,
    available_on: JSON.parse(b.available_on || '[]'), flags,
  };
}

function buildContext(ticket) {
  const author = db.prepare('SELECT name, joined_date FROM authors WHERE id = ?').get(ticket.author_id);
  const ctx = { author: { name: author.name, joined: author.joined_date }, payout_schedule: payoutSchedule() };
  if (ticket.book_id) {
    ctx.book = bookFacts(db.prepare('SELECT * FROM books WHERE id = ?').get(ticket.book_id));
  } else {
    // Account-level ticket: compact one-line-per-book summary instead of full records.
    ctx.books = db.prepare('SELECT * FROM books WHERE author_id = ?').all(ticket.author_id).map((b) => {
      const f = bookFacts(b);
      return { title: f.title, status: f.status, pending: f.royalty_pending, paid: f.royalty_paid, last_payout: f.last_payout_date, flags: f.flags };
    });
  }
  return ctx;
}

module.exports = { buildContext, payoutSchedule };
