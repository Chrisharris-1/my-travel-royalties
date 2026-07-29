// POST /.netlify/functions/chat-messages
// Body: { agentEmail, agentCode, channel }
// Returns the message history for a channel ("team" or another agent's
// email for a DM thread). Front end polls this every few seconds.
// Also returns the roster (name/email/role) so the DM picker can be built
// without hardcoding agent names in the front end.
const { getStore, connectLambda } = require('@netlify/blobs');
const { jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');
const { findAgent, loadAgents } = require('./_agent-auth');
const { conversationKey, canAccessChannel } = require('./_chat-shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });
  connectLambda(event);

  try {
    const { agentEmail, agentCode, channel } = JSON.parse(event.body || '{}');
    if (!channel) return jsonResponse(400, { error: true, message: 'channel is required' });

    const auth = findAgent(agentEmail, agentCode);
    if (!auth.configured) return jsonResponse(503, { error: true, message: 'Agent accounts are not configured yet.' });
    if (!auth.agent) return jsonResponse(401, { error: true, message: 'Invalid email or access code.' });

    const access = canAccessChannel(auth.agent, channel);
    if (!access.allowed) return jsonResponse(403, { error: true, message: access.reason });

    const store = getStore('chat');
    const key = conversationKey(auth.agent.email, channel);
    const messages = (await store.get(key, { type: 'json' })) || [];

    const agents = (loadAgents() || []).map(a => ({ name: a.name, email: a.email, role: a.role === 'lead' ? 'lead' : 'agent' }));

    return jsonResponse(200, { data: messages, roster: agents, self: auth.agent });
  } catch (err) {
    return errorResponse(err);
  }
};
