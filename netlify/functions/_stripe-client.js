// Shared Stripe API client. Card numbers/CVV NEVER pass through this file —
// they go straight from the customer's browser into Stripe's own hosted
// Elements widget and are tokenized there. All this file ever sees is a
// SetupIntent id and, once confirmed, the resulting payment method's
// non-sensitive summary (brand, last4, billing name) — never raw card data.
const BASE_URL = 'https://api.stripe.com/v1';

function getKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set in the environment.');
  }
  return key;
}

async function stripeRequest(path, { method = 'GET', params } = {}) {
  let url = `${BASE_URL}${path}`;
  const body = params instanceof URLSearchParams ? params.toString() : undefined;
  if (method === 'GET' && params) {
    url += `?${params.toString()}`;
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${getKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method !== 'GET' ? body : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error((json.error && json.error.message) || `Stripe API error ${res.status}`);
    err.status = res.status;
    err.details = json;
    throw err;
  }
  return json;
}

module.exports = { stripeRequest };
