/** In-process Server-Sent Events hub. Admins receive every event; authors only their own tickets'. */
const clients = new Set();

function addClient(res, user) {
  const client = { res, user };
  clients.add(client);
  const hb = setInterval(() => res.write(': hb\n\n'), 25_000);
  res.on('close', () => { clearInterval(hb); clients.delete(client); });
}

function emit(type, { ticketId, authorId }) {
  const payload = `event: ${type}\ndata: ${JSON.stringify({ ticketId })}\n\n`;
  for (const { res, user } of clients) {
    if (user.role === 'admin' || user.author_id === authorId) res.write(payload);
  }
}

module.exports = { addClient, emit };
