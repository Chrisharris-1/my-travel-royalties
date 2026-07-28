// POST /.netlify/functions/payments
// Pays off a "hold" order before its ticketing deadline, or pays for a confirmed
// order change that has an outstanding balance.
// Body: { orderId, amount, currency, type: "balance" }
const { duffelRequest, jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });

  try {
    const input = JSON.parse(event.body || '{}');
    const { orderId, amount, currency, type = 'balance' } = input;

    if (!orderId || !amount || !currency) {
      return jsonResponse(400, {
        error: true,
        message: 'orderId, amount, and currency are required',
      });
    }

    const result = await duffelRequest('/air/payments', {
      method: 'POST',
      body: {
        order_id: orderId,
        payment: { type, amount, currency },
      },
    });
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
};
