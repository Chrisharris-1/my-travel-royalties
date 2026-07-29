// Sale Form — records a completed sale of any kind (flight, hotel, car,
// package, membership) so it shows up in reporting, separate from the
// Duffel flight-quote flow and the pre-sale Leads tracker.
//
// POST { action: "create", agentEmail, agentCode, customerName, customerEmail,
//         customerPhone, productType, saleAmount, currency, commission,
//         saleDate, notes }
// GET ?ref=SALE-XXXXXX
const { getStore, connectLambda } = require('@netlify/blobs');
const { jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');
const { findAgent } = require('./_agent-auth');

const REF_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PRODUCT_TYPES = ['flight', 'hotel', 'car', 'package', 'membership', 'other'];

function generateRef() {
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_CHARS[Math.floor(Math.random() * REF_CHARS.length)];
  return `SALE-${s}`;
}

function salesStore() {
  return getStore('sales');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  connectLambda(event);

  try {
    const store = salesStore();

    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      if (!qs.ref) return jsonResponse(400, { error: true, message: 'ref is required' });
      const sale = await store.get(qs.ref.toUpperCase(), { type: 'json' });
      if (!sale) return jsonResponse(404, { error: true, message: `No sale found for reference ${qs.ref}` });
      return jsonResponse(200, { data: sale });
    }

    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'GET or POST only' });

    const input = JSON.parse(event.body || '{}');
    if (input.action !== 'create') return jsonResponse(400, { error: true, message: 'action must be "create"' });

    const authResult = findAgent(input.agentEmail, input.agentCode);
    if (authResult.configured && !authResult.agent) {
      return jsonResponse(401, { error: true, message: 'Invalid agent email or access code' });
    }
    const resolvedAgentName = authResult.agent ? authResult.agent.name : (input.agentName || 'Unknown agent');
    const resolvedAgentEmail = authResult.agent ? authResult.agent.email : (input.agentEmail || null);

    const { customerName, customerEmail, customerPhone, saleAmount, currency, commission, saleDate, notes } = input;
    if (!customerName) return jsonResponse(400, { error: true, message: 'customerName is required' });
    const amount = Number(saleAmount);
    if (!isFinite(amount) || amount <= 0) return jsonResponse(400, { error: true, message: 'saleAmount must be a positive number' });
    const productType = PRODUCT_TYPES.includes(input.productType) ? input.productType : 'other';

    let ref = generateRef();
    for (let i = 0; i < 5 && (await store.get(ref, { type: 'json' })); i++) ref = generateRef();

    const sale = {
      ref,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agentName: resolvedAgentName,
      agentEmail: resolvedAgentEmail,
      customerName,
      customerEmail: customerEmail || null,
      customerPhone: customerPhone || null,
      productType,
      saleAmount: amount,
      currency: currency || 'USD',
      commission: commission != null && commission !== '' ? Number(commission) : null,
      saleDate: saleDate || new Date().toISOString().slice(0, 10),
      notes: notes || '',
    };

    await store.setJSON(ref, sale);
    return jsonResponse(200, { data: sale });
  } catch (err) {
    return errorResponse(err);
  }
};
