require('dotenv').config();
const env = process.env;
const isProd = env.NODE_ENV === 'production';

if (isProd && !env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');

module.exports = {
  isProd,
  port: Number(env.PORT) || 3000,
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtTtl: '8h',
  dbPath: env.DB_PATH || './data/bookleaf.db',
  ai: {
    // The key lives only in the server environment. It is never serialised to any API response.
    apiKey: env.ANTHROPIC_API_KEY || '',
    model: env.AI_MODEL || 'claude-haiku-5-5',
    url: env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages',
    timeoutMs: Number(env.AI_TIMEOUT_MS) || 15000,
    enabled: env.AI_ENABLED !== 'false',
  },
  demo: {
    authorPassword: env.DEMO_AUTHOR_PASSWORD || 'Author@123',
    adminPassword: env.DEMO_ADMIN_PASSWORD || 'Admin@123',
  },
};
