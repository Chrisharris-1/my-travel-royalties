// POST /.netlify/functions/agent-leads
// Body: { email, code }
// Lists call-submission / potential-lead entries from the "leads" Blobs store.
//   - role "agent" -> only leads that agent logged
//   - role "lead"  -> every agent's leads (the "master login" view)
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

    const store = getStore('leads');
    const { blobs } = await store.list();
    const leads = [];
    for (const b of blobs) {
      const lead = await store.get(b.key, { type: 'json' });
      if (!lead) continue;
      if (auth.agent.role !== 'lead' && (lead.agentEmail || '').toLowerCase() !== auth.agent.email.toLowerCase()) {
        continue;
      }
      leads.push(lead);
    }
    leads.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return jsonResponse(200, { data: leads, viewer: auth.agent });
  } catch (err) {
    return errorResponse(err);
  }
};
