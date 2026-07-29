// Shared LiteAPI (Nuitee Connect) client used by every stays-*.js function.
// Reads the secret key from the server-side environment variable only —
// this file never runs in the browser, so the key is never exposed to visitors.
//
// LiteAPI splits its API across two base URLs:
//   - https://api.liteapi.travel/v3.0   -> search, hotel data, places
//   - https://book.liteapi.travel/v3.0  -> prebook / book / manage bookings
// Both use the same X-API-Key header for auth (Simple Authentication).

const SEARCH_BASE_URL = 'https://api.liteapi.travel/v3.0';
const BOOK_BASE_URL = 'https://book.liteapi.travel/v3.0';

function getKey() {
  const key = process.env.LITEAPI_KEY;
  if (!key) {
    throw new Error('LITEAPI_KEY is not set in the environment.');
  }
  return key;
}

async function liteapiRequest(base, path, { method = 'GET', body, query } = {}) {
  const baseUrl = base === 'book' ? BOOK_BASE_URL : SEARCH_BASE_URL;
  let url = `${baseUrl}${path}`;
  if (query && Object.keys(query).length) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.set(k, v);
    }
    url += `?${params.toString()}`;
  }

  const res = await fetch(url, {
    method,
    headers: {
      'X-API-Key': getKey(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`LiteAPI error ${res.status}`);
    err.status = res.status;
    err.details = json;
    throw err;
  }
  return json;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS',
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

function errorResponse(err) {
  console.error(err);
  const status = err.status || 500;
  return jsonResponse(status, {
    error: true,
    message: err.message || 'Unexpected server error',
    details: err.details || undefined,
  });
}

function handleOptions() {
  return { statusCode: 204, headers: CORS_HEADERS, body: '' };
}

module.exports = { liteapiRequest, jsonResponse, errorResponse, handleOptions, CORS_HEADERS };
