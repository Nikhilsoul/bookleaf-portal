const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS authors (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  phone TEXT, city TEXT, joined_date TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('author','admin')),
  name TEXT NOT NULL,
  author_id TEXT REFERENCES authors(id)
);
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES authors(id),
  title TEXT NOT NULL, isbn TEXT, genre TEXT, publication_date TEXT,
  status TEXT NOT NULL, mrp INTEGER, author_royalty_per_copy INTEGER,
  total_copies_sold INTEGER NOT NULL DEFAULT 0,
  total_royalty_earned INTEGER NOT NULL DEFAULT 0,
  royalty_paid INTEGER NOT NULL DEFAULT 0,
  royalty_pending INTEGER NOT NULL DEFAULT 0,
  last_royalty_payout_date TEXT, print_partner TEXT,
  available_on TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author_id);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id TEXT NOT NULL REFERENCES authors(id),
  book_id TEXT REFERENCES books(id),
  subject TEXT NOT NULL, description TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL DEFAULT 'General Inquiry',
  category_source TEXT NOT NULL DEFAULT 'rules' CHECK (category_source IN ('ai','rules','admin')),
  priority TEXT NOT NULL DEFAULT 'Medium',
  priority_source TEXT NOT NULL DEFAULT 'rules' CHECK (priority_source IN ('ai','rules','admin')),
  ai_reasoning TEXT,
  ai_status TEXT NOT NULL DEFAULT 'pending' CHECK (ai_status IN ('pending','done','fallback')),
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Resolved','Closed')),
  assigned_to INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_author ON tickets(author_id);
CREATE INDEX IF NOT EXISTS idx_tickets_queue ON tickets(status, priority, created_at);

-- Public thread (visible to the author). The original query lives on tickets.description.
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('author','admin')),
  sender_name TEXT NOT NULL, body TEXT NOT NULL,
  ai_assisted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msgs_ticket ON ticket_messages(ticket_id);

-- Internal notes: never returned by any author-facing endpoint.
CREATE TABLE IF NOT EXISTS ticket_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  admin_name TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
);

-- One cached draft per ticket; marked stale when the category changes or the author replies.
CREATE TABLE IF NOT EXISTS ai_drafts (
  ticket_id INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  body TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('ai','template')),
  model TEXT, stale INTEGER NOT NULL DEFAULT 0, generated_at TEXT NOT NULL
);

-- Token/cost ledger so spend is observable per call type.
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, kind TEXT NOT NULL,
  model TEXT, input_tokens INTEGER, output_tokens INTEGER, latency_ms INTEGER,
  ok INTEGER NOT NULL, error TEXT, created_at TEXT NOT NULL
);
`);

module.exports = db;
