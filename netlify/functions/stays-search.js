// POST /.netlify/functions/stays-search
// Body: { destination, checkin, checkout, adults, children, rooms, currency, guestNationality }
// Live hotel search via LiteAPI (Nuitee Connect):
//   1. Resolve the free-text destination (e.g. "Rome, Italy") to a Google
//      Place ID via GET /data/places.
//   2. Search real-time rates for hotels in that place via POST /hotels/rates.
// Returns { data: [...] } — each item is a hotel with its cheapest rate(s).
const { liteapiRequest, jsonResponse, errorResponse, handleOptions } = require('./_liteapi-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });

  try {
    const input = JSON.parse(event.body || '{}');
    const {
      destination,
      checkin,
      checkout,
      adults = 2,
      children = 0,
      rooms = 1,
      currency = 'USD',
      guestNationality = 'US',
    } = input;

    if (!destination || !checkin || !checkout) {
      return jsonResponse(400, {
        error: true,
        message: 'destination, checkin, and checkout are required',
      });
    }

    // Step 1 — resolve the destination text to a Place ID.
    const places = await liteapiRequest('search', '/data/places', {
      method: 'GET',
      query: { textQuery: destination, type: 'locality,administrative_area_level_3' },
    });
    const place = places && places.data && places.data[0];
    if (!place || !place.placeId) {
      return jsonResponse(404, {
        error: true,
        message: `Couldn't find a matching destination for "${destination}". Try a different spelling or a nearby major city.`,
      });
    }

    // Step 2 — build one occupancy entry per room (evenly splitting adults,
    // remainder goes to the first room; children default to none per room).
    const perRoomAdults = Math.max(1, Math.floor(adults / rooms));
    const remainder = adults - perRoomAdults * rooms;
    const occupancies = Array.from({ length: rooms }, (_, i) => ({
      adults: perRoomAdults + (i === 0 ? remainder : 0),
      ...(children ? { children: i === 0 ? Array(children).fill(10) : [] } : {}),
    }));

    const result = await liteapiRequest('search', '/hotels/rates', {
      method: 'POST',
      body: {
        placeId: place.placeId,
        checkin,
        checkout,
        currency,
        guestNationality,
        occupancies,
        maxRatesPerHotel: 3,
        includeHotelData: true,
        limit: 40,
        timeout: 8,
      },
    });

    return jsonResponse(200, { data: result.data || [], place: { name: place.displayName || destination, placeId: place.placeId } });
  } catch (err) {
    return errorResponse(err);
  }
};
