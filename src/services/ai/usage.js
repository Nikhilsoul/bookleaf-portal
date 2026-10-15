const db = require('../../db');

const insert = db.prepare(`INSERT INTO ai_usage (ticket_id, kind, model, input_tokens, output_tokens, latency_ms, ok, error, created_at)
  VALUES (?,?,?,?,?,?,?,?,?)`);

/** Wraps an AI call, recording tokens/latency/outcome. Re-throws failures after logging. */
async function tracked(kind, ticketId, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    insert.run(ticketId, kind, out.model, out.usage.input, out.usage.output, Date.now() - t0, 1, null, new Date().toISOString());
    return out;
  } catch (e) {
    insert.run(ticketId, kind, null, null, null, Date.now() - t0, 0, String(e.message).slice(0, 200), new Date().toISOString());
    throw e;
  }
}

const summary = () =>
  db.prepare(`SELECT kind, COUNT(*) calls, SUM(ok) ok_calls, COALESCE(SUM(input_tokens),0) input_tokens,
    COALESCE(SUM(output_tokens),0) output_tokens, CAST(AVG(latency_ms) AS INTEGER) avg_latency_ms
    FROM ai_usage GROUP BY kind`).all();

module.exports = { tracked, summary };
