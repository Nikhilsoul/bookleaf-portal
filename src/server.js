const config = require('./config');
const { createApp } = require('./app');
const { seed, seedTickets } = require('./db/seed');
const provider = require('./services/ai/provider');

if (seed()) console.log('Database seeded from data/bookleaf_sample_data.json');
seedTickets();

createApp().listen(config.port, () => {
  console.log(`BookLeaf portal on http://localhost:${config.port}`);
  console.log(provider.isConfigured() ? `AI enabled (model: ${config.ai.model})` : 'AI not configured: running with rules-based triage and template drafts');
});
