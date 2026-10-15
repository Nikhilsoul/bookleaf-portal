/**
 * BookLeaf Knowledge Base, split into small sections so each AI call only receives the
 * policy text relevant to the ticket's category (cost control) instead of the whole KB.
 */
const CATEGORIES = [
  'Royalty & Payments',
  'ISBN & Metadata Issues',
  'Printing & Quality',
  'Distribution & Availability',
  'Book Status & Production Updates',
  'General Inquiry',
];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

const SECTIONS = {
  company: `BookLeaf Publishing: self-publishing company in India and the US. Packages: Standard Free (no upfront cost) and Bestseller Breakthrough (paid, with marketing and distribution add-ons). We handle cover design, typesetting, ISBN, printing, distribution and royalty management. In-house printing facility and warehouse in Delhi; print partners Repro India and Epitome Books.`,
  royalty: `ROYALTY POLICY: 80/20 split of net profit per book (80% author, 20% BookLeaf). Net profit = MRP minus printing cost, platform commission (Amazon/Flipkart) and shipping. Royalties are calculated quarterly and paid within 45 days of quarter end. Minimum payout threshold Rs 1,000; below that, royalties roll over to the next quarter. Paid by bank transfer to the account linked in the author dashboard. The dashboard shows a royalty breakdown with sales per platform. We can share a detailed line-by-line breakdown on request.`,
  isbn: `ISBN POLICY: every book gets a unique ISBN assigned by BookLeaf, registered under BookLeaf's publisher imprint. An ISBN under the author's own imprint must be obtained by the author independently. ISBN errors (duplicate, wrong book linked, mismatch between platforms and physical copy) are HIGH priority and escalated to the production team. Metadata updates (description, bio, categories) can be submitted via the dashboard or by emailing the team; changes reflect on platforms in 3-5 business days.`,
  printing: `PRINTING & QUALITY: in-house printing handles most orders; overflow or special formats go to Repro India or Epitome Books. Standard print turnaround 5-7 business days from order confirmation. For quality issues (misprints, binding defects, colour inconsistency) BookLeaf arranges a FREE reprint after verification; the author may need to share photos of the defective copy.`,
  distribution: `DISTRIBUTION: books are listed on Amazon India, Flipkart, Amazon US, Amazon UK and the BookLeaf Store. New listings go live 7-10 business days after publication is complete. A book showing "unavailable" on a platform is usually a stock sync issue; the team can trigger a re-sync within 24-48 hours. Only claim availability on platforms listed in the account facts.`,
  production: `PRODUCTION STAGES: Manuscript Received > Editing (if opted) > Cover Design > Typesetting > Proofreading > ISBN Assignment > Printing > Distribution Setup > Published & Live. Authors get an email at each stage. Delays usually occur at Cover Design (awaiting author approval) and Proofreading (revision rounds). If delayed, be honest about why and give a specific updated timeline; frame author-side delays collaboratively, never as blame.`,
};

/** Which KB sections each category needs. Keep these tight: every section costs tokens. */
const CATEGORY_SECTIONS = {
  'Royalty & Payments': ['royalty'],
  'ISBN & Metadata Issues': ['isbn'],
  'Printing & Quality': ['printing'],
  'Distribution & Availability': ['distribution'],
  'Book Status & Production Updates': ['production'],
  'General Inquiry': ['company', 'isbn'],
};

const TONE = `TONE: empathetic and professional; authors are partners, not customers to be managed. Acknowledge the concern before solutions. Be specific: use actual numbers, dates and statuses from the account facts, not vague reassurance. If BookLeaf is at fault (delayed royalty, ISBN error) own it directly with no corporate deflection. If escalation or investigation is needed, give a clear timeline (e.g. "within 48 hours"), never open-ended promises. Always end with a clear next step for the author and/or the BookLeaf team.`;

/** One short reference reply per category to calibrate voice (only the matching one is sent). */
const EXAMPLES = {
  'Royalty & Payments': `Hi Asha,\n\nI'm sorry for the worry. Waiting on a payout with no update is frustrating, and you deserve a clear answer. Royalties are calculated quarterly and paid within 45 days of quarter end, so your next payout is due by 14 Feb. I can see Rs 3,570 pending on your account. I'm asking our finance team to confirm your bank details are linked and will update you within 48 hours.\n\nWarm regards,\nBookLeaf Author Support`,
  'ISBN & Metadata Issues': `Hi Ravi,\n\nThank you for flagging this. An ISBN mismatch is a serious data issue and it's on us to fix. I'm escalating it to our production team right now as high priority and you'll have a resolution update within 48 hours. Please reply with a screenshot of the Amazon listing so we can match it faster.\n\nWarm regards,\nBookLeaf Author Support`,
  'Printing & Quality': `Hi Neha,\n\nI'm truly sorry your author copies arrived like this. That is not the standard we hold ourselves to. Please send photos of the blurry pages and misalignment; once we verify, we'll arrange a free reprint, which takes 5-7 business days.\n\nWarm regards,\nBookLeaf Author Support`,
  'Distribution & Availability': `Hi Karan,\n\nThanks for catching this. "Currently Unavailable" is usually a stock sync issue, not a problem with your book. I'm asking our distribution team to trigger a re-sync now; expect it to be live again within 24-48 hours. I'll confirm here once it is.\n\nWarm regards,\nBookLeaf Author Support`,
  'Book Status & Production Updates': `Hi Meena,\n\nThanks for checking in, and I understand the wait feels long. Your book is currently in Typesetting. We're waiting on proof approval, which we can sort together quickly. If you can approve by Friday, we expect to move to proofreading next week. I'll update you the moment it moves.\n\nWarm regards,\nBookLeaf Author Support`,
  'General Inquiry': `Hi Sam,\n\nGreat question. Yes, you can update your book description after it's live, either through your dashboard or by emailing our team. Changes usually reflect on platforms within 3-5 business days. Send us the new text and we'll take it from there.\n\nWarm regards,\nBookLeaf Author Support`,
};

const policyFor = (category) =>
  (CATEGORY_SECTIONS[category] || CATEGORY_SECTIONS['General Inquiry']).map((k) => SECTIONS[k]).join('\n');

module.exports = { CATEGORIES, PRIORITIES, SECTIONS, TONE, EXAMPLES, policyFor };
