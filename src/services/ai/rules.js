/**
 * Deterministic fallback used when the LLM is unavailable (and as a business-rule floor on top of it).
 * Guarantees every ticket gets a sensible category + priority, and every admin gets a usable draft.
 */
const RULES = [
  ['Royalty & Payments', /royalt|payout|payment|paid|bank (detail|account|transfer)|earning|commission|withdraw|too low|net profit/i],
  ['ISBN & Metadata Issues', /isbn|barcode|wrong book|duplicate (listing|book)|metadata (error|mismatch)|mismatch/i],
  ['Printing & Quality', /print|misprint|blurry|binding|misalign|colou?r|reprint|defect|quality|pages? (fell|torn|missing)|author copies/i],
  ['Distribution & Availability', /amazon|flipkart|unavailable|out of stock|listing|not (showing|visible|available)|store|stock|re-?sync|distribut/i],
  ['Book Status & Production Updates', /typesett|proof|cover design|editing|production|status|when will|how long|delay|manuscript|stuck/i],
];
const BASE_PRIORITY = {
  'Royalty & Payments': 2, 'ISBN & Metadata Issues': 1, 'Printing & Quality': 1,
  'Distribution & Availability': 2, 'Book Status & Production Updates': 2, 'General Inquiry': 3,
};
const LEVELS = ['Critical', 'High', 'Medium', 'Low'];

function ruleCategory(text) {
  // Routine metadata edits are General Inquiries (per KB sample), not ISBN problems.
  if (/\b(update|change|edit|add)\b[^.]{0,40}\b(bio|description|author bio|categories|keywords)\b/i.test(text)) return 'General Inquiry';
  let best = ['General Inquiry', 0];
  for (const [cat, re] of RULES) {
    const hits = (text.match(new RegExp(re.source, 'gi')) || []).length;
    if (hits > best[1]) best = [cat, hits];
  }
  return best[0];
}

function rulePriority(category, text) {
  let p = BASE_PRIORITY[category];
  const months = Number((/(\d+)\s*months?/i.exec(text) || [])[1] || 0);
  if (/legal|lawyer|court|fraud|scam|cheat|consumer forum|police/i.test(text)) p = 0;
  else if (category === 'Royalty & Payments' && (months >= 5 || /never (received|got)|haven'?t (received|got) any|no royalt/i.test(text))) p = months >= 5 ? 0 : 1;
  else if (/urgent|immediately|asap|still (waiting|not)|again|launch|event/i.test(text)) p = Math.max(0, p - 1);
  if (category === 'General Inquiry' && /\bcan i\b|how (do|can) i|update my/i.test(text)) p = 3;
  return LEVELS[p];
}

function classifyByRules({ subject, description }) {
  const text = `${subject}\n${description}`;
  const category = ruleCategory(text);
  return { category, priority: rulePriority(category, text), reasoning: 'Rule-based fallback (AI unavailable)' };
}

/** Business rule from the KB: reported ISBN errors are always at least High (routine metadata edits are not). Applied on top of AI output too. */
function applyPolicyFloor(category, priority, text = '') {
  const isError = /error|wrong|duplicate|mismatch|different|incorrect|not matching|mixed/i.test(text);
  if (category === 'ISBN & Metadata Issues' && isError && LEVELS.indexOf(priority) > 1) {
    return { priority: 'High', floored: true };
  }
  return { priority, floored: false };
}

const inr = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN')}`;

/** Template drafts built from the same account facts the LLM would see. Clearly labelled in the UI. */
function templateDraft(category, ctx) {
  const first = ctx.author.name.split(' ')[0];
  const b = ctx.book;
  const title = b ? `"${b.title}"` : 'your account';
  const sign = '\n\nWarm regards,\nBookLeaf Author Support';
  const open = `Hi ${first},\n\nThank you for reaching out about ${title}. `;
  switch (category) {
    case 'Royalty & Payments': {
      const due = ctx.payout_schedule.payout_due_by;
      const facts = b
        ? b.royalty_pending > 0
          ? `I can see ${inr(b.royalty_pending)} pending on your account (${inr(b.royalty_paid)} paid so far). ${b.royalty_pending < 1000 ? 'That is below our Rs 1,000 minimum payout threshold, so it rolls over to the next quarter.' : ''}`
          : `Your royalties on this title are fully paid (${inr(b.royalty_paid)}).`
        : '';
      return `${open}I understand how important clear answers on royalties are. Royalties are calculated quarterly and paid within 45 days of quarter end by bank transfer; the current cycle is due by ${due}. ${facts}\n\nI'm asking our finance team to verify your bank details and payout status, and we'll update you within 48 hours.${sign}`;
    }
    case 'ISBN & Metadata Issues':
      return `${open}I'm sorry for the trouble; an ISBN or metadata error is a serious issue and we take it seriously. I'm escalating this to our production team as high priority and you'll have an update within 48 hours. To speed things up, please reply with a screenshot of the listing showing the incorrect details.${sign}`;
    case 'Printing & Quality':
      return `${open}I'm sincerely sorry about the print quality. Please share clear photos of the affected pages or binding. Once verified we will arrange a free reprint, which takes 5-7 business days.${sign}`;
    case 'Distribution & Availability':
      return `${open}A book showing as unavailable is usually a stock sync issue. I'm asking our distribution team to trigger a re-sync now; it should be resolved within 24-48 hours and I'll confirm here once it is live.${sign}`;
    case 'Book Status & Production Updates':
      return `${open}${b ? `Your book is currently at "${b.status}". ` : ''}I'm checking with the production team for the exact next milestone and will send you a specific timeline within 48 hours.${sign}`;
    default:
      return `${open}Thanks for your question. Our team is looking into it and we'll reply with a complete answer within 48 hours. If you can share any extra details, please reply here.${sign}`;
  }
}

module.exports = { classifyByRules, applyPolicyFloor, templateDraft, LEVELS };
