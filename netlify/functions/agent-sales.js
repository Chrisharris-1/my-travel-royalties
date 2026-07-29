// POST /.netlify/functions/agent-sales
// Body: { email, code }
//   - role "agent" -> only sales that agent logged
//   - role "lead"  -> every agent's sales
const { getStore, connectLambda } = require('@netlify/blobs');
const { jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');
const { findAgent } = require('./_agent-auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });
  connectLambda(event);

  try {
    const { email, code } = JSON.parse(event.body || '{}');
    if (!email || !code) return jsonResponse(400, { error: true, message: 'email and code are required' });

    const auth = findAgent(email, code);
    if (!auth.configured) return jsonResponse(503, { error: true, message: 'Agent accounts are not configured yet.' });
    if (!auth.agent) return jsonResponse(401, { error: true, message: 'Invalid email or access code.' });

    const store = getStore('sales');
    const { blobs } = await store.list();
    const sales = [];
    for (const b of blobs) {
      const sale = await store.get(b.key, { type: 'json' });
      if (!sale) continue;
      if (auth.agent.role !== 'lead' && (sale.agentEmail || '').toLowerCase() !== auth.agent.email.toLowerCase()) {
        continue;
      }
      sales.push(sale);
    }
    sales.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return jsonResponse(200, { data: sales, viewer: auth.agent });
  } catch (err) {
    return errorResponse(err);
  }
};
