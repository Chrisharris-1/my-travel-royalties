// POST /.netlify/functions/stays-quotes  body: { rateId }
// Locks in a rate's price for a short window before booking (prices can move otherwise).
const { duffelRequest, jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });

  try {
    const input = JSON.parse(event.body || '{}');
    if (!input.rateId) return jsonResponse(400, { error: true, message: 'rateId is required' });

    const result = await duffelRequest('/stays/quotes', {
      method: 'POST',
      body: { rate_id: input.rateId },
    });
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
};
