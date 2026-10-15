const { z } = require('zod');
const { CATEGORIES, PRIORITIES } = require('../services/ai/knowledgeBase');

const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];
const text = (min, max, label) => z.string().trim().min(min, `${label} must be at least ${min} characters`).max(max, `${label} must be at most ${max} characters`);

module.exports = {
  STATUSES,
  login: z.object({ email: z.string().trim().email('Enter a valid email'), password: z.string().min(1, 'Password is required') }),
  createTicket: z.object({
    book_id: z.string().trim().min(1).nullish(),
    subject: text(5, 150, 'Subject'),
    description: text(20, 5000, 'Description'),
    attachments: z.array(z.object({ name: z.string().max(200), size: z.number().int().nonnegative().optional() })).max(5).optional(),
  }),
  message: z.object({ body: text(1, 5000, 'Message') }),
  adminList: z.object({
    status: z.enum(STATUSES).optional(), category: z.enum(CATEGORIES).optional(), priority: z.enum(PRIORITIES).optional(),
    assigned: z.enum(['me', 'unassigned']).optional(), sort: z.enum(['urgency', 'newest', 'oldest']).optional(),
    q: z.string().trim().max(100).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  }),
  patchTicket: z.object({
    status: z.enum(STATUSES).optional(), category: z.enum(CATEGORIES).optional(), priority: z.enum(PRIORITIES).optional(),
    assigned_to: z.enum(['me']).nullable().optional(),
  }).refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update'),
  reply: z.object({ body: text(1, 5000, 'Reply'), status: z.enum(STATUSES).optional(), ai_assisted: z.boolean().optional() }),
};
