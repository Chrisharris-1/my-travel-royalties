// GET /.netlify/functions/offers?offer_request_id=xxx&sort=total_amount&limit=50
// GET /.netlify/functions/offers?id=off_xxx&return_available_services=true   (single offer)
const { duffelRequest, jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: true, message: 'GET only' });

  try {
    const qs = event.queryStringParameters || {};

    if (qs.id) {
      const result = await duffelRequest(`/air/offers/${qs.id}`, {
        query: {
          return_available_services: qs.return_available_services,
        },
      });
      return jsonResponse(200, result);
    }

    if (!qs.offer_request_id) {
      return jsonResponse(400, { error: true, message: 'offer_request_id or id is required' });
    }

    const result = await duffelRequest('/air/offers', {
      query: {
        offer_request_id: qs.offer_request_id,
        sort: qs.sort || 'total_amount',
        limit: qs.limit || '50',
        after: qs.after,
        before: qs.before,
        max_connections: qs.max_connections,
      },
    });
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
};
