// Duffel Payments — lets you charge a customer's card directly (separate from
// paying orders out of your Duffel account Balance). Requires Duffel Payments
// to be enabled for this account/region; if it isn't, Duffel returns an error
// here that we pass straight through so the caller can tell what's wrong.
//
// POST { amount, currency }   -> creates a PaymentIntent, returns { id, client_token, ... }
// POST { confirmId }          -> confirms a PaymentIntent (tops up your Balance)
// GET  ?id=pit_xxx            -> fetch a PaymentIntent's status
const { duffelRequest, jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  try {
    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      if (!qs.id) return jsonResponse(400, { error: true, message: 'id is required' });
      const result = await duffelRequest(`/payments/payment_intents/${qs.id}`);
      return jsonResponse(200, result);
    }

    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: true, message: 'GET or POST only' });
    }

    const input = JSON.parse(event.body || '{}');

    if (input.confirmId) {
      const result = await duffelRequest(`/payments/payment_intents/${input.confirmId}/actions/confirm`, {
        method: 'POST',
        body: {},
      });
      return jsonResponse(200, result);
    }

    if (!input.amount || !input.currency) {
      return jsonResponse(400, { error: true, message: 'amount and currency are required' });
    }

    const result = await duffelRequest('/payments/payment_intents', {
      method: 'POST',
      body: { amount: String(input.amount), currency: input.currency },
    });
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
};
