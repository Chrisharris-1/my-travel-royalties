// POST /.netlify/functions/agent-login
// Body: { email, code }
// Validates against AGENT_ACCOUNTS (see _agent-auth.js). Returns
// { data: { name, email, role } } on success — role is "agent" or "lead".
const { jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');
const { findAgent } = require('./_agent-auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });

  try {
    const { email, code } = JSON.parse(event.body || '{}');
    if (!email || !code) {
      return jsonResponse(400, { error: true, message: 'email and code are required' });
    }

    const result = findAgent(email, code);
    if (!result.configured) {
      return jsonResponse(503, {
        error: true,
        message: 'Agent accounts are not configured yet. Ask an admin to set AGENT_ACCOUNTS in Netlify.',
      });
    }
    if (!result.agent) {
      return jsonResponse(401, { error: true, message: 'Invalid email or access code.' });
    }
    return jsonResponse(200, { data: result.agent });
  } catch (err) {
    return errorResponse(err);
  }
};
