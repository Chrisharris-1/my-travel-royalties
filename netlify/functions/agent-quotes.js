// POST /.netlify/functions/agent-quotes
// Body: { email, code }
// Lists quotes from the same Blobs store quotes.js writes to.
//   - role "agent" -> only quotes that agent created
//   - role "lead"  -> every agent's quotes (the "master login" view)
const { getStore, connectLambda } = require('@netlify/blobs');
const { jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');
const { findAgent } = require('./_agent-auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });

  try {
    connectLambda(event);
    const { email, code } = JSON.parse(event.body || '{}');
    if (!email || !code) return jsonResponse(400, { error: true, message: 'email and code are required' });

    const auth = findAgent(email, code);
    if (!auth.configured) {
      return jsonResponse(503, { error: true, message: 'Agent accounts are not configured yet.' });
    }
    if (!auth.agent) {
      return jsonResponse(401, { error: true, message: 'Invalid email or access code.' });
    }

    const store = getStore('quotes');
    const { blobs } = await store.list();
    const quotes = [];
    for (const b of blobs) {
      const quote = await store.get(b.key, { type: 'json' });
      if (!quote) continue;
      if (auth.agent.role !== 'lead' && (quote.agentEmail || '').toLowerCase() !== auth.agent.email.toLowerCase()) {
        continue; // regular agents only see their own quotes
      }
      quotes.push({
        mtrRef: quote.mtrRef,
        status: quote.status,
        agentName: quote.agentName,
        agentEmail: quote.agentEmail,
        customerEmail: quote.customerEmail,
        totalAmount: quote.totalAmount,
        totalCurrency: quote.totalCurrency,
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
      });
    }
    quotes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return jsonResponse(200, { data: quotes, viewer: auth.agent });
  } catch (err) {
    return errorResponse(err);
  }
};
