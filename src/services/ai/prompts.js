const { CATEGORIES, TONE, EXAMPLES, policyFor } = require('./knowledgeBase');

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}...[truncated]` : s);

// ---------- Classification (small, KB-free prompt) ----------
const classifySystem = () => `You triage author support tickets for BookLeaf Publishing (self-publishing, India/US).
Respond with ONLY a JSON object, no prose: {"category": string, "priority": string, "reasoning": string}

category must be exactly one of:
${CATEGORIES.map((c) => `- ${c}`).join('\n')}
Guide: Royalty & Payments = money owed/paid/calculated. ISBN & Metadata Issues = ISBN errors, wrong/duplicate data, description/bio edits. Printing & Quality = physical copy defects, reprints. Distribution & Availability = listings, "unavailable", platform visibility. Book Status & Production Updates = where the book is in production, delays. General Inquiry = everything else.

priority must be exactly one of Critical | High | Medium | Low:
- Critical: money long overdue (e.g. no royalty for 5+ months), legal/fraud threats, data loss, or multiple severe problems at once.
- High: ISBN errors, defective printed copies, missing royalty payment, a live book unavailable and losing sales.
- Medium: production delays, availability questions, royalty calculation queries, general concerns without financial or reputational damage.
- Low: informational or how-to questions, small edits (e.g. updating an author bio), no urgency.
Judge by actual content and urgency, not tone alone. "reasoning" is max 20 words.`;

const classifyUser = (t, bookLabel) =>
  `Book: ${bookLabel || 'General / Account Level'}\nSubject: ${clip(t.subject, 200)}\nDescription: ${clip(t.description, 1500)}`;

// ---------- Draft generation ----------
const draftSystem = () => `You are a support representative at BookLeaf Publishing writing a reply to an author. A human admin will review and edit your draft before it is sent.

${TONE}

RULES:
- Ground every claim in the POLICY and ACCOUNT FACTS provided. Never invent numbers, dates, platforms, or policies. If a needed fact is missing, say the team will check and give a timeline.
- Use real figures from account facts (pending royalty, last payout, status, platforms). Flags in account facts tell you which edge case applies; address it explicitly.
- If a book is still in production there are no sales or royalties yet; say so kindly and give the current stage.
- Do not state the ticket priority or category, and do not mention being an AI.
- Plain text only (no markdown, no bullet symbols). 110-200 words. Begin with "Hi <first name>,". End with the sign-off "Warm regards,\\nBookLeaf Author Support".`;

/**
 * Builds the draft prompt. Cost controls: only the policy sections for this category, one example,
 * only the referenced book (or a compact list for account-level tickets), and the last 4 thread
 * messages truncated. Internal notes are never included.
 */
function draftUser({ category, ctx, ticket, thread }) {
  const history = thread
    .slice(-4)
    .map((m) => `${m.sender_role === 'author' ? 'AUTHOR' : 'BOOKLEAF'}: ${clip(m.body, 500)}`)
    .join('\n');
  return `<policy>\n${policyFor(category)}\n</policy>

<reference_reply category="${category}">\n${EXAMPLES[category]}\n</reference_reply>

<account_facts>\n${JSON.stringify(ctx)}\n</account_facts>

<ticket category="${category}">
Subject: ${clip(ticket.subject, 200)}
Description: ${clip(ticket.description, 2000)}
</ticket>
${history ? `\n<later_messages>\n${history}\n</later_messages>\n` : ''}
Write the reply now. Match the voice of the reference reply but use only this author's facts.`;
}

module.exports = { classifySystem, classifyUser, draftSystem, draftUser };
