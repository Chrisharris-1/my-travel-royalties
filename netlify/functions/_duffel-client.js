// Shared Duffel API client used by every function in this folder.
// Reads the secret key from the server-side environment variable only —
// this file never runs in the browser, so the key is never exposed to visitors.

const BASE_URL = 'https://api.duffel.com';
const DUFFEL_VERSION = 'v2';

function getKey() {
  const key = process.env.DUFFEL_API_KEY;
  if (!key) {
    throw new Error('DUFFEL_API_KEY is not set in the environment.');
  }
  return key;
}

async function duffelRequest(path, { method = 'GET', body, query } = {}) {
  let url = `${BASE_URL}${path}`;
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
      'Authorization': `Bearer ${getKey()}`,
      'Duffel-Version': DUFFEL_VERSION,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify({ data: body }) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`Duffel API error ${res.status}`);
    err.status = res.status;
    err.details = json;
    throw err;
  }
  return json;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
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

module.exports = { duffelRequest, jsonResponse, errorResponse, handleOptions, CORS_HEADERS };
