// This is the URL you register with Duffel as your webhook endpoint:
//   https://mytravelroyalties.com/.netlify/functions/webhook-receiver
//
// Duffel signs every webhook with a `Duffel-Signature: t=<timestamp>,v1=<hmac>` header.
// Verify it with the webhook secret Duffel gives you when the webhook is created
// (stored as DUFFEL_WEBHOOK_SECRET), so this endpoint only acts on genuine Duffel events.
//
// Handles: order.created, order.cancelled, order.airline_initiated_change_detected,
// order_change.confirmed, payment.created, air.airline_credit.created, and any future
// event types (unhandled ones are logged, not rejected, so new Duffel events don't 500).
const crypto = require('crypto');

function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret) return true; // no secret configured yet — accept but log a warning below
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.split('='))
  );
  const { t, v1 } = parts;
  if (!t || !v1) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'POST only' };
  }

  const secret = process.env.DUFFEL_WEBHOOK_SECRET;
  const signatureHeader = event.headers['duffel-signature'] || event.headers['Duffel-Signature'];
  const rawBody = event.body || '';

  if (!verifySignature(rawBody, signatureHeader, secret)) {
    console.warn('Webhook signature verification failed — rejecting.');
    return { statusCode: 401, body: 'Invalid signature' };
  }
  if (!secret) {
    console.warn('DUFFEL_WEBHOOK_SECRET is not set — signature was not actually verified.');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const eventType = payload.data && payload.data.type;
  const object = payload.data && payload.data.object;

  switch (eventType) {
    case 'order.created':
      console.log('Order created:', object && object.id);
      break;
    case 'order.cancelled':
      console.log('Order cancelled:', object && object.id);
      break;
    case 'order.airline_initiated_change_detected':
      console.log('Airline-initiated change on order:', object && object.id);
      // TODO: notify the traveller (email/SMS) — hook up to your notification
      // provider here once one is connected.
      break;
    case 'order_change.confirmed':
      console.log('Order change confirmed:', object && object.id);
      break;
    case 'payment.created':
      console.log('Payment created:', object && object.id);
      break;
    case 'air.airline_credit.created':
      console.log('Airline credit issued:', object && object.id);
      break;
    default:
      console.log('Unhandled Duffel webhook event:', eventType);
  }

  // Always 200 quickly so Duffel doesn't retry — long-running work should be
  // handed off to a queue/background function rather than done inline here.
  return { statusCode: 200, body: 'ok' };
};
