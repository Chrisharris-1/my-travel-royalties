// Call Submission / Potential Lead tracker for the Agent Portal.
// Lets an agent log a call they just had — contact details, what they're
// interested in, how the call went — without it being a formal booking
// quote. Team leads can see every agent's leads via agent-leads.js.
//
// POST { action: "create", agentEmail, agentCode, customerName, customerPhone,
//         customerEmail, interest, notes, outcome, followUpDate }
// -> validates the agent (see _agent-auth.js), stores the lead, returns it
// GET ?ref=LEAD-XXXXXX
// -> fetch a single lead by reference
const { getStore, connectLambda } = require('@netlify/blobs');
const { jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');
const { findAgent } = require('./_agent-auth');

const REF_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const OUTCOMES = ['interested', 'booked', 'not_interested', 'follow_up_needed', 'no_answer'];

function generateRef() {
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_CHARS[Math.floor(Math.random() * REF_CHARS.length)];
  return `LEAD-${s}`;
}

function leadsStore() {
  return getStore('leads');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  connectLambda(event);

  try {
    const store = leadsStore();

    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      if (!qs.ref) return jsonResponse(400, { error: true, message: 'ref is required' });
      const lead = await store.get(qs.ref.toUpperCase(), { type: 'json' });
      if (!lead) return jsonResponse(404, { error: true, message: `No lead found for reference ${qs.ref}` });
      return jsonResponse(200, { data: lead });
    }

    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: true, message: 'GET or POST only' });
    }

    const input = JSON.parse(event.body || '{}');
    if (input.action !== 'create') {
      return jsonResponse(400, { error: true, message: 'action must be "create"' });
    }

    const authResult = findAgent(input.agentEmail, input.agentCode);
    if (authResult.configured && !authResult.agent) {
      return jsonResponse(401, { error: true, message: 'Invalid agent email or access code' });
    }
    const resolvedAgentName = authResult.agent ? authResult.agent.name : (input.agentName || 'Unknown agent');
    const resolvedAgentEmail = authResult.agent ? authResult.agent.email : (input.agentEmail || null);

    const { customerName, customerPhone, customerEmail, interest, notes, followUpDate } = input;
    if (!customerName) return jsonResponse(400, { error: true, message: 'customerName is required' });
    if (!customerPhone && !customerEmail) {
      return jsonResponse(400, { error: true, message: 'At least one of customerPhone or customerEmail is required' });
    }
    const outcome = OUTCOMES.includes(input.outcome) ? input.outcome : 'follow_up_needed';

    let ref = generateRef();
    for (let i = 0; i < 5 && (await store.get(ref, { type: 'json' })); i++) ref = generateRef();

    const lead = {
      ref,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agentName: resolvedAgentName,
      agentEmail: resolvedAgentEmail,
      customerName,
      customerPhone: customerPhone || null,
      customerEmail: customerEmail || null,
      interest: interest || null,
      notes: notes || '',
      outcome,
      followUpDate: followUpDate || null,
    };

    await store.setJSON(ref, lead);
    return jsonResponse(200, { data: lead });
  } catch (err) {
    return errorResponse(err);
  }
};
