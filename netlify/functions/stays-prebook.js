// POST /.netlify/functions/stays-prebook
// Body: { offerId }
// Step 1 of 2 in the LiteAPI booking flow — confirms the rate is still
// available and returns final pricing plus a prebookId used to complete
// the booking. Doesn't charge anything yet.
const { liteapiRequest, jsonResponse, errorResponse, handleOptions } = require('./_liteapi-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });

  try {
    const input = JSON.parse(event.body || '{}');
    const { offerId } = input;
    if (!offerId) return jsonResponse(400, { error: true, message: 'offerId is required' });

    const result = await liteapiRequest('book', '/rates/prebook', {
      method: 'POST',
      body: { offerId, usePaymentSdk: false },
    });
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
};
