// Card verification only — creates and retrieves a Stripe SetupIntent.
// A SetupIntent validates that a card is real and chargeable WITHOUT
// placing any charge or hold on it. The card number/expiry/CVV are typed
// directly into Stripe's own hosted Elements widget in the customer's
// browser and confirmed client-side with the publishable key below;
// this server-side function only ever creates the intent and, afterwards,
// re-reads its authoritative status from Stripe (never trusts the browser's
// own claim of success).
//
// POST  -> creates a SetupIntent, returns { id, client_secret, publishableKey }
// GET ?id=seti_xxx -> retrieves a SetupIntent (with payment_method expanded)
const { stripeRequest } = require('./_stripe-client');
const { jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  try {
    if (event.httpMethod === 'POST') {
      const params = new URLSearchParams();
      params.append('payment_method_types[]', 'card');
      params.append('usage', 'off_session');
      const si = await stripeRequest('/setup_intents', { method: 'POST', params });
      const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || null;
      return jsonResponse(200, { id: si.id, client_secret: si.client_secret, publishableKey });
    }

    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      if (!qs.id) return jsonResponse(400, { error: true, message: 'id is required' });
      const params = new URLSearchParams();
      params.append('expand[]', 'payment_method');
      const si = await stripeRequest(`/setup_intents/${encodeURIComponent(qs.id)}`, { method: 'GET', params });
      return jsonResponse(200, si);
    }

    return jsonResponse(405, { error: true, message: 'GET or POST only' });
  } catch (err) {
    return errorResponse(err);
  }
};
