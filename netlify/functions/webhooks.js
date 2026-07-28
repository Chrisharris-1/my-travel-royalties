// Manage which URL Duffel sends events to.
// GET  /.netlify/functions/webhooks              -> list registered webhooks
// POST /.netlify/functions/webhooks  { url }      -> register this site's receiver
// This only needs to be run once (or after the receiver URL changes) — not on
// every page load.
const { duffelRequest, jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  try {
    if (event.httpMethod === 'GET') {
      const result = await duffelRequest('/webhooks');
      return jsonResponse(200, result);
    }

    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: true, message: 'GET or POST only' });
    }

    const input = JSON.parse(event.body || '{}');
    const url = input.url || 'https://mytravelroyalties.com/.netlify/functions/webhook-receiver';

    const result = await duffelRequest('/webhooks', {
      method: 'POST',
      body: { url, events: ['*'] },
    });
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
};
