// POST /.netlify/functions/chat-send
// Body: { agentEmail, agentCode, channel, text }
//   channel = "team"  -> the team-wide channel
//   channel = an email -> a direct message to that agent (see _chat-shared.js
//   for who's allowed to DM whom)
const { getStore, connectLambda } = require('@netlify/blobs');
const { jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');
const { findAgent } = require('./_agent-auth');
const { conversationKey, canAccessChannel } = require('./_chat-shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });
  connectLambda(event);

  try {
    const { agentEmail, agentCode, channel, text } = JSON.parse(event.body || '{}');
    if (!channel || !text || !text.trim()) {
      return jsonResponse(400, { error: true, message: 'channel and text are required' });
    }

    const auth = findAgent(agentEmail, agentCode);
    if (!auth.configured) return jsonResponse(503, { error: true, message: 'Agent accounts are not configured yet.' });
    if (!auth.agent) return jsonResponse(401, { error: true, message: 'Invalid email or access code.' });

    const access = canAccessChannel(auth.agent, channel);
    if (!access.allowed) return jsonResponse(403, { error: true, message: access.reason });

    const store = getStore('chat');
    const key = conversationKey(auth.agent.email, channel);
    const existing = (await store.get(key, { type: 'json' })) || [];

    const message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromEmail: auth.agent.email,
      fromName: auth.agent.name,
      text: text.trim().slice(0, 2000),
      createdAt: new Date().toISOString(),
    };
    existing.push(message);
    // Keep conversations from growing unbounded.
    const trimmed = existing.slice(-500);
    await store.setJSON(key, trimmed);

    return jsonResponse(200, { data: message });
  } catch (err) {
    return errorResponse(err);
  }
};
