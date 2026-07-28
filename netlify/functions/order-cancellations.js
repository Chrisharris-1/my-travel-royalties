// POST /.netlify/functions/order-cancellations   body: { orderId }         -> get a refund quote
// POST /.netlify/functions/order-cancellations   body: { confirmId }       -> confirm the cancellation
// GET  /.netlify/functions/order-cancellations?id=xxx                     -> check status
const { duffelRequest, jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  try {
    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      if (!qs.id) return jsonResponse(400, { error: true, message: 'id is required' });
      const result = await duffelRequest(`/air/order_cancellations/${qs.id}`);
      return jsonResponse(200, result);
    }

    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: true, message: 'GET or POST only' });
    }

    const input = JSON.parse(event.body || '{}');

    if (input.confirmId) {
      const result = await duffelRequest(
        `/air/order_cancellations/${input.confirmId}/actions/confirm`,
        { method: 'POST', body: {} }
      );
      return jsonResponse(200, result);
    }

    if (!input.orderId) {
      return jsonResponse(400, { error: true, message: 'orderId is required to request a quote' });
    }

    const result = await duffelRequest('/air/order_cancellations', {
      method: 'POST',
      body: { order_id: input.orderId },
    });
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
};
