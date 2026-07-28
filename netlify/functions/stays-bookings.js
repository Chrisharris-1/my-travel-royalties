// POST /.netlify/functions/stays-bookings  -> confirm a hotel booking from a quote
//   body: { quoteId, email, phoneNumber, guests:[{givenName,familyName}], amount, currency }
// GET  /.netlify/functions/stays-bookings?id=xxx   -> fetch a booking
// POST /.netlify/functions/stays-bookings  { cancelBookingId } -> cancel a booking
const { duffelRequest, jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  try {
    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      if (!qs.id) return jsonResponse(400, { error: true, message: 'id is required' });
      const result = await duffelRequest(`/stays/bookings/${qs.id}`);
      return jsonResponse(200, result);
    }

    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: true, message: 'GET or POST only' });
    }

    const input = JSON.parse(event.body || '{}');

    if (input.cancelBookingId) {
      const result = await duffelRequest(
        `/stays/bookings/${input.cancelBookingId}/actions/cancel`,
        { method: 'POST', body: {} }
      );
      return jsonResponse(200, result);
    }

    const { quoteId, email, phoneNumber, guests, amount, currency } = input;
    if (!quoteId || !email || !guests) {
      return jsonResponse(400, { error: true, message: 'quoteId, email, and guests are required' });
    }

    const result = await duffelRequest('/stays/bookings', {
      method: 'POST',
      body: {
        quote_id: quoteId,
        email,
        phone_number: phoneNumber,
        guests: guests.map((g) => ({ given_name: g.givenName, family_name: g.familyName })),
        payment: { type: 'balance', amount, currency },
      },
    });
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
};
