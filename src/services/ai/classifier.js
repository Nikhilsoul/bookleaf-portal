const { z } = require('zod');
const provider = require('./provider');
const { tracked } = require('./usage');
const { CATEGORIES, PRIORITIES } = require('./knowledgeBase');
const { classifySystem, classifyUser } = require('./prompts');
const { classifyByRules, applyPolicyFloor } = require('./rules');

const resultSchema = z.object({
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  reasoning: z.string().max(300).catch(''),
});

/** Pull the first JSON object out of a completion (tolerates stray prose or code fences). */
function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON object in completion');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Classify a ticket. Always resolves: falls back to rules on any provider or parsing failure.
 * Cost: a tiny prompt (rubric + ticket text only, no KB, no history) with max_tokens=120.
 */
async function classifyTicket(ticket, bookLabel) {
  try {
    const out = await tracked('classify', ticket.id, () =>
      provider.complete({ system: classifySystem(), user: classifyUser(ticket, bookLabel), maxTokens: 120 })
    );
    const parsed = resultSchema.parse(parseJson(out.text));
    const { priority, floored } = applyPolicyFloor(parsed.category, parsed.priority, `${ticket.subject} ${ticket.description}`);
    return { ...parsed, priority, reasoning: floored ? `${parsed.reasoning} (raised to High per ISBN policy)` : parsed.reasoning, source: 'ai' };
  } catch (e) {
    console.warn(`[ai] classify fallback for ticket ${ticket.id}: ${e.message}`);
    const r = classifyByRules(ticket);
    const { priority } = applyPolicyFloor(r.category, r.priority, `${ticket.subject} ${ticket.description}`);
    return { ...r, priority, source: 'rules' };
  }
}

module.exports = { classifyTicket, parseJson };
