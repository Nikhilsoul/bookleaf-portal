/**
 * Thin LLM client (Anthropic Messages API over fetch; no SDK dependency).
 * Resilience: per-request timeout, one retry on 429/5xx/network errors (honouring Retry-After),
 * and a circuit breaker that short-circuits calls for 60s after 3 consecutive failures so a
 * provider outage can never slow down ticket creation or the admin UI.
 */
const config = require('../../config');

class AIUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AIUnavailableError';
  }
}

const breaker = { failures: 0, openUntil: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isConfigured = () => config.ai.enabled && Boolean(config.ai.apiKey);

async function complete({ system, user, maxTokens }) {
  if (!isConfigured()) throw new AIUnavailableError('AI is not configured (no API key or AI_ENABLED=false)');
  if (Date.now() < breaker.openUntil) throw new AIUnavailableError('AI temporarily disabled after repeated failures');

  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.ai.timeoutMs);
    try {
      const res = await fetch(config.ai.url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': config.ai.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: config.ai.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        if (!text) throw new AIUnavailableError('Empty completion');
        breaker.failures = 0;
        return {
          text,
          model: data.model || config.ai.model,
          usage: { input: data.usage?.input_tokens ?? null, output: data.usage?.output_tokens ?? null },
        };
      }
      lastError = new AIUnavailableError(`Provider returned HTTP ${res.status}`);
      if (res.status !== 429 && res.status < 500) break; // 4xx (bad key, bad request) will not fix itself
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Math.min(retryAfter > 0 ? retryAfter * 1000 : 800 * (attempt + 1), 3000));
    } catch (e) {
      lastError = e instanceof AIUnavailableError ? e : new AIUnavailableError(e.name === 'AbortError' ? 'Provider timed out' : `Network error: ${e.message}`);
      await sleep(500);
    } finally {
      clearTimeout(timer);
    }
  }
  if (++breaker.failures >= 3) breaker.openUntil = Date.now() + 60_000;
  throw lastError;
}

const resetBreaker = () => { breaker.failures = 0; breaker.openUntil = 0; };

module.exports = { complete, isConfigured, resetBreaker, AIUnavailableError };
