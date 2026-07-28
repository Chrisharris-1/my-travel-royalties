// GET /.netlify/functions/seat-maps?offer_id=off_xxx
const { duffelRequest, jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: true, message: 'GET only' });

  try {
    const qs = event.queryStringParameters || {};
    if (!qs.offer_id) {
      return jsonResponse(400, { error: true, message: 'offer_id is required' });
    }
    const result = await duffelRequest('/air/seat_maps', {
      query: { offer_id: qs.offer_id },
    });
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
};
