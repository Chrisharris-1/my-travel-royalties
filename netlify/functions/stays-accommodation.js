// GET /.netlify/functions/stays-accommodation?id=acc_xxx
// Full property details + every available rate (not just the cheapest one search returns).
const { duffelRequest, jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: true, message: 'GET only' });

  try {
    const qs = event.queryStringParameters || {};
    if (!qs.id) return jsonResponse(400, { error: true, message: 'id is required' });
    const result = await duffelRequest(`/stays/accommodation/${qs.id}`);
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
};
