// Frequent-flyer numbers a member has saved to their profile, attached to future
// offer requests / orders so fares and seat priority reflect their status.
// POST /.netlify/functions/loyalty-programme-accounts  body: { airlineIataCode, accountNumber }
// GET  /.netlify/functions/loyalty-programme-accounts?id=xxx
//
// NOTE: Duffel does not persist a reusable "member profile" object of its own —
// loyalty accounts are supplied per passenger on each offer_request/order. This
// function validates the airline via Duffel's airline lookup and hands back a
// normalised object the frontend stores against the signed-in member (e.g. in
// your own membership/account database) and re-sends on every future search.
const { duffelRequest, jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });

  try {
    const input = JSON.parse(event.body || '{}');
    const { airlineIataCode, accountNumber } = input;
    if (!airlineIataCode || !accountNumber) {
      return jsonResponse(400, {
        error: true,
        message: 'airlineIataCode and accountNumber are required',
      });
    }

    const airlines = await duffelRequest('/air/airlines', {
      query: { iata_code: airlineIataCode },
    });
    const airline = airlines.data && airlines.data[0];
    if (!airline) {
      return jsonResponse(404, { error: true, message: 'Unknown airline IATA code' });
    }

    return jsonResponse(200, {
      data: {
        airline_iata_code: airlineIataCode,
        airline_name: airline.name,
        account_number: accountNumber,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};
