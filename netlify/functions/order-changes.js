// Three-step Duffel order-change flow, all handled through one function via `step`:
//
// POST { step: "request", orderId, slices: { add:[...], remove:[...] } }
//   -> creates an order_change_request, returns available change offers
// POST { step: "offers", changeRequestId }
//   -> lists the priced change offers for a change request
// POST { step: "confirm", changeOfferId }
//   -> creates + immediately confirms the order change (charges/refunds the difference)
// GET ?id=xxx -> fetch a single order change
const { duffelRequest, jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  try {
    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      if (!qs.id) return jsonResponse(400, { error: true, message: 'id is required' });
      const result = await duffelRequest(`/air/order_changes/${qs.id}`);
      return jsonResponse(200, result);
    }

    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: true, message: 'GET or POST only' });
    }

    const input = JSON.parse(event.body || '{}');

    if (input.step === 'request') {
      if (!input.orderId || !input.slices) {
        return jsonResponse(400, { error: true, message: 'orderId and slices are required' });
      }
      const result = await duffelRequest('/air/order_change_requests', {
        method: 'POST',
        body: { order_id: input.orderId, slices: input.slices },
      });
      return jsonResponse(200, result);
    }

    if (input.step === 'offers') {
      if (!input.changeRequestId) {
        return jsonResponse(400, { error: true, message: 'changeRequestId is required' });
      }
      const result = await duffelRequest('/air/order_change_offers', {
        query: { order_change_request_id: input.changeRequestId },
      });
      return jsonResponse(200, result);
    }

    if (input.step === 'confirm') {
      if (!input.changeOfferId) {
        return jsonResponse(400, { error: true, message: 'changeOfferId is required' });
      }
      const created = await duffelRequest('/air/order_changes', {
        method: 'POST',
        body: { selected_order_change_offer: input.changeOfferId },
      });
      const changeId = created.data && created.data.id;
      const confirmed = await duffelRequest(`/air/order_changes/${changeId}/actions/confirm`, {
        method: 'POST',
        body: {},
      });
      return jsonResponse(200, confirmed);
    }

    return jsonResponse(400, {
      error: true,
      message: 'step must be one of "request", "offers", "confirm"',
    });
  } catch (err) {
    return errorResponse(err);
  }
};
