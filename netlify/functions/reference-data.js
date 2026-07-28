// GET /.netlify/functions/reference-data?type=airlines&query=BA
// GET /.netlify/functions/reference-data?type=airports&query=lon
// GET /.netlify/functions/reference-data?type=aircraft
// GET /.netlify/functions/reference-data?type=places&query=Lond   (autocomplete for the search form)
const { duffelRequest, jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

const PATHS = {
  airlines: '/air/airlines',
  airports: '/air/airports',
  aircraft: '/air/aircraft',
  places: '/places/suggestions',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: true, message: 'GET only' });

  try {
    const qs = event.queryStringParameters || {};
    const type = qs.type;
    if (!PATHS[type]) {
      return jsonResponse(400, {
        error: true,
        message: 'type must be one of airlines, airports, aircraft, places',
      });
    }

    if (qs.id) {
      const result = await duffelRequest(`${PATHS[type]}/${qs.id}`);
      return jsonResponse(200, result);
    }

    const query =
      type === 'places'
        ? { query: qs.query }
        : { iata_code: qs.iata_code, name: qs.query, limit: qs.limit || '50' };

    const result = await duffelRequest(PATHS[type], { query });
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
};
