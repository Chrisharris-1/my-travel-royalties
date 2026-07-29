// POST /.netlify/functions/stays-book
// Body: { prebookId, holder:{firstName,lastName,email}, guests:[...], transactionId, clientReference }
// Step 2 of 2 — completes a real LiteAPI hotel booking.
//
// Payment note: this deliberately only supports the "TRANSACTION" payment
// method (a tokenized transactionId from LiteAPI's client-side Payment SDK).
// It does NOT accept raw card numbers here — collecting and forwarding full
// card PAN/CVV through our own server is a PCI-scope and safety problem we
// avoid everywhere else on this site (flights use Stripe SetupIntent + a
// human-reviewed quote instead of touching card data directly). Wire up
// LiteAPI's Payment SDK on the front end to get a transactionId, then pass
// it here.
const crypto = require('crypto');
const { liteapiRequest, jsonResponse, errorResponse, handleOptions } = require('./_liteapi-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });

  try {
    const input = JSON.parse(event.body || '{}');
    const { prebookId, holder, guests, transactionId, clientReference } = input;

    if (!prebookId) return jsonResponse(400, { error: true, message: 'prebookId is required' });
    if (!holder || !holder.firstName || !holder.lastName || !holder.email) {
      return jsonResponse(400, { error: true, message: 'holder.firstName, holder.lastName and holder.email are required' });
    }
    if (!Array.isArray(guests) || !guests.length) {
      return jsonResponse(400, { error: true, message: 'guests (at least one) is required' });
    }
    if (!transactionId) {
      return jsonResponse(400, {
        error: true,
        message: 'transactionId is required — complete payment with the LiteAPI Payment SDK on the front end first, then pass the resulting transactionId here.',
      });
    }

    const result = await liteapiRequest('book', '/rates/book', {
      method: 'POST',
      body: {
        prebookId,
        clientReference: clientReference || `MTR-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
        holder,
        guests,
        payment: { method: 'TRANSACTION', transactionId },
      },
    });
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
};
