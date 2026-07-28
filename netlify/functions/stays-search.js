// POST /.netlify/functions/stays-search
// Body: { location: {lat,lng} or { radius, ... }, checkInDate, checkOutDate, rooms:[{guests:[{type:"adult"}]}] }
// Returns accommodations with their cheapest rate for the stay.
const { duffelRequest, jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });

  try {
    const input = JSON.parse(event.body || '{}');
    const { location, checkInDate, checkOutDate, rooms } = input;

    if (!location || !checkInDate || !checkOutDate || !rooms) {
      return jsonResponse(400, {
        error: true,
        message: 'location, checkInDate, checkOutDate, and rooms are required',
      });
    }

    const result = await duffelRequest('/stays/search', {
      method: 'POST',
      body: {
        location,
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
        rooms,
      },
    });
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
};
