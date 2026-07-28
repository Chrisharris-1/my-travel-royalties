// POST /.netlify/functions/offer-requests
// Creates a Duffel "offer request" — this is the flight search step.
// Body: { slices: [{origin, destination, departure_date}], passengers: [{type:"adult"}...],
//          cabin_class, max_connections, return_offers }
const { duffelRequest, jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });

  try {
    const input = JSON.parse(event.body || '{}');
    const {
      slices,
      passengers,
      cabinClass = 'economy',
      maxConnections,
      returnOffers = true,
    } = input;

    if (!Array.isArray(slices) || !slices.length) {
      return jsonResponse(400, { error: true, message: 'slices[] is required' });
    }
    if (!Array.isArray(passengers) || !passengers.length) {
      return jsonResponse(400, { error: true, message: 'passengers[] is required' });
    }

    const body = {
      slices: slices.map((s) => ({
        origin: s.origin,
        destination: s.destination,
        departure_date: s.departureDate || s.departure_date,
      })),
      passengers: passengers.map((p) => ({
        type: p.type || 'adult',
        ...(p.age ? { age: p.age } : {}),
        ...(p.loyaltyProgrammeAccounts
          ? { loyalty_programme_accounts: p.loyaltyProgrammeAccounts }
          : {}),
      })),
      cabin_class: cabinClass,
      ...(maxConnections !== undefined ? { max_connections: maxConnections } : {}),
    };

    const result = await duffelRequest(
      `/air/offer_requests?return_offers=${returnOffers ? 'true' : 'false'}`,
      { method: 'POST', body }
    );

    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
};
