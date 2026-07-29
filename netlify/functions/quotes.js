// Sales-agent quote system. Nothing here ever calls Duffel's order-creation
// endpoint — it only stores a quote (an offer snapshot + agent markup + the
// passenger details the agent collected), emails the customer a full
// itinerary + price review under our own "MTR-XXXXXX" reference, and — once
// the customer confirms the details are correct — verifies their card is
// live via Stripe (no charge, no hold) before flagging the quote ready for
// a human to complete the real booking. Turning a verified quote into a
// real, ticketed Duffel order remains a deliberate separate step.
//
// POST { action: "create", offer, markup, passenger, billingAddress, customerEmail, agentEmail, agentCode }
// -> validates the agent (see _agent-auth.js), stores a quote, generates
//    MTR-XXXXXX, best-effort emails the customer
// GET ?ref=MTR-XXXXXX
// -> fetch a quote by reference (used by My Trips + the verification page)
// POST { action: "confirm", ref }
// -> customer confirms the itinerary/passenger/price details are correct
// POST { action: "cancel", ref }
// -> customer (or agent) flags the quote as not to proceed
// POST { action: "card-verify-result", ref, setupIntentId }
// -> looks the SetupIntent up on Stripe's side (never trusts the browser),
// and sets status to card_verified / pending_manual_review / payment_declined
const { getStore, connectLambda } = require('@netlify/blobs');
const { jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');
const { stripeRequest } = require('./_stripe-client');
const { findAgent } = require('./_agent-auth');

const REF_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L — avoids confusion when read aloud

function generateRef() {
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_CHARS[Math.floor(Math.random() * REF_CHARS.length)];
  return `MTR-${s}`;
}

function quotesStore() {
  return getStore('quotes');
}

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

// Loose match: at least one meaningful name token in common between the
// cardholder's billing name and the traveling passenger's name. This is
// intentionally forgiving (couples booking on one card, middle names,
// nicknames) — anything looser than "no overlap at all" gets routed to a
// human for a quick call rather than auto-declined, exactly like a real
// travel agency's "different card name" verification step.
function namesLikelyMatch(billingName, passenger) {
  const billingTokens = normalizeName(billingName);
  const passengerTokens = normalizeName(`${passenger.given_name} ${passenger.family_name}`);
  if (!billingTokens.length || !passengerTokens.length) return false;
  return billingTokens.some((t) => passengerTokens.includes(t));
}

function fmtMoney(amount, currency) {
  const n = Number(amount);
  return `${currency} ${n.toFixed(2)}`;
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function billingAddressLine(b) {
  if (!b) return '';
  return [b.line1, b.line2, b.city, b.state, b.postal_code, b.country].filter(Boolean).join(', ');
}

function flightDetailsHtml(offer) {
  return offer.slices
    .map((s) => {
      const segs = s.segments
        .map((seg) => {
          const airline = (seg.marketing_carrier && seg.marketing_carrier.name) || (offer.owner && offer.owner.name) || 'Airline';
          const flightNo = seg.marketing_carrier_flight_number || '';
          return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6ddc9;border-radius:8px;margin:0 0 12px;">
<tr>
<td style="padding:14px 16px;">
<div style="font-size:13px;color:#6f6659;font-weight:600;letter-spacing:.03em;text-transform:uppercase;">${airline}${flightNo ? ' &middot; Flight ' + flightNo : ''}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
<tr>
<td style="font-size:20px;font-weight:700;color:#1b1712;">${seg.origin.iata_code}</td>
<td style="text-align:center;color:#6f6659;font-size:12px;padding:0 10px;">&#9992;</td>
<td style="font-size:20px;font-weight:700;color:#1b1712;text-align:right;">${seg.destination.iata_code}</td>
</tr>
<tr>
<td style="font-size:13px;color:#6f6659;">${fmtTime(seg.departing_at)}</td>
<td></td>
<td style="font-size:13px;color:#6f6659;text-align:right;">${fmtTime(seg.arriving_at)}</td>
</tr>
</table>
<div style="font-size:12.5px;color:#6f6659;margin-top:8px;">${fmtDateTime(seg.departing_at)}</div>
</td>
</tr>
</table>`;
        })
        .join('');
      return segs;
    })
    .join('');
}

async function sendVerificationEmail(quote) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, reason: 'RESEND_API_KEY is not set — quote was created but no email was sent.' };
  }
  const from = process.env.QUOTE_EMAIL_FROM || 'My Travel Royalties <onboarding@resend.dev>';
  const verifyUrl = `https://mytravelroyalties.com/verify-booking.html?ref=${encodeURIComponent(quote.mtrRef)}`;
  const p = quote.passenger;
  const first = quote.offer.slices[0].segments[0];
  const lastSeg = quote.offer.slices[0].segments[quote.offer.slices[0].segments.length - 1];

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;background:#f7f3ea;padding:24px 12px;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e6ddc9;border-radius:10px;overflow:hidden;">

<div style="background:#ffffff;padding:24px 28px;border-bottom:1px solid #e6ddc9;">
<div style="font-family:Georgia,'Playfair Display',serif;font-size:20px;font-weight:700;color:#1b1712;">My Travel Royalties</div>
<div style="font-size:12px;color:#6f6659;margin-top:2px;">Reference ${quote.mtrRef}</div>
</div>

<div style="padding:26px 28px;">
<h2 style="font-family:Georgia,'Playfair Display',serif;font-size:20px;color:#1b1712;margin:0 0 12px;">Please review your flight before we book it</h2>
<p style="font-size:14px;color:#3a342c;line-height:1.6;margin:0 0 14px;">
Hi ${p.given_name}, your travel advisor${quote.agentName ? ' (' + quote.agentName + ')' : ''} has put together the itinerary and price below.
<b>Nothing has been booked or charged yet.</b> Before you confirm, please check carefully that the following are correct:
</p>
<ul style="font-size:13.5px;color:#3a342c;line-height:1.7;margin:0 0 20px;padding-left:20px;">
<li>Passenger name (must exactly match the government ID or passport used to travel)</li>
<li>Origin, destination and travel dates</li>
<li>Airline, flight number(s) and departure/arrival times</li>
<li>Total price and currency</li>
</ul>

<div style="font-size:13px;font-weight:700;color:#1b1712;text-transform:uppercase;letter-spacing:.03em;margin:0 0 10px;">Flight Details</div>
${flightDetailsHtml(quote.offer)}

<div style="font-size:13px;font-weight:700;color:#1b1712;text-transform:uppercase;letter-spacing:.03em;margin:20px 0 10px;">Traveler Details</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6ddc9;border-radius:8px;">
<tr>
<td style="padding:14px 16px;font-size:13.5px;color:#1b1712;">
<div style="font-weight:700;">${p.given_name} ${p.family_name}</div>
<div style="color:#6f6659;margin-top:4px;">Date of birth: ${p.born_on}</div>
<div style="color:#6f6659;margin-top:2px;">Email: ${p.email || quote.customerEmail}</div>
<div style="color:#6f6659;margin-top:2px;">Phone: ${p.phone_number}</div>
</td>
</tr>
</table>

<div style="font-size:13px;font-weight:700;color:#1b1712;text-transform:uppercase;letter-spacing:.03em;margin:20px 0 10px;">Price Details</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6ddc9;border-radius:8px;">
<tr>
<td style="padding:14px 16px;font-size:13.5px;color:#3a342c;">Base fare</td>
<td style="padding:14px 16px;font-size:13.5px;color:#3a342c;text-align:right;">${fmtMoney(quote.fareAmount, quote.fareCurrency)}</td>
</tr>
<tr>
<td style="padding:0 16px 14px;font-size:13.5px;color:#3a342c;border-bottom:1px solid #e6ddc9;">Service fee</td>
<td style="padding:0 16px 14px;font-size:13.5px;color:#3a342c;text-align:right;border-bottom:1px solid #e6ddc9;">${fmtMoney(quote.markupAmount, quote.fareCurrency)}</td>
</tr>
<tr>
<td style="padding:14px 16px;font-size:16px;font-weight:800;color:#1b1712;">Total</td>
<td style="padding:14px 16px;font-size:16px;font-weight:800;color:#1b1712;text-align:right;">${fmtMoney(quote.totalAmount, quote.totalCurrency)}</td>
</tr>
</table>

${quote.billingAddress ? `
<div style="font-size:13px;font-weight:700;color:#1b1712;text-transform:uppercase;letter-spacing:.03em;margin:20px 0 10px;">Billing Address</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6ddc9;border-radius:8px;">
<tr><td style="padding:14px 16px;font-size:13.5px;color:#3a342c;">${billingAddressLine(quote.billingAddress)}</td></tr>
</table>` : ''}

<div style="font-size:13px;font-weight:700;color:#1b1712;text-transform:uppercase;letter-spacing:.03em;margin:20px 0 10px;">Terms &amp; Conditions</div>
<div style="border:1px solid #e6ddc9;border-radius:8px;padding:14px 16px;font-size:12px;color:#6f6659;line-height:1.7;">
Prices shown are quoted by your travel advisor and are not guaranteed until confirmed and a card is verified. Airline fare rules govern refunds, changes and name-change restrictions once a ticket is issued. By clicking Confirm &amp; Pay you confirm the passenger and itinerary details above are accurate; name corrections after ticketing may not be possible with the airline.
</div>

<div style="text-align:center;margin:28px 0 6px;">
<a href="${verifyUrl}" style="display:inline-block;background:#C6A15B;color:#1c1712;font-weight:700;font-size:15px;text-decoration:none;padding:14px 34px;border-radius:6px;">Confirm &amp; Pay</a>
</div>
<p style="text-align:center;font-size:11.5px;color:#9a9081;margin:8px 0 0;">If anything above is incorrect — especially the spelling of the name — do not confirm; reply to this email instead.</p>
</div>

<div style="background:#f7f3ea;padding:16px 28px;font-size:11px;color:#9a9081;">
My Travel Royalties &middot; Reference ${quote.mtrRef}
</div>
</div>
</div>
`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: quote.customerEmail,
        subject: `Please confirm your flight — ${first.origin.iata_code} to ${lastSeg.destination.iata_code} (${quote.mtrRef})`,
        html,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { sent: false, reason: `Email provider returned ${res.status}: ${text}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  // Our functions use the classic Lambda-compatible handler signature, so the
  // Blobs environment isn't auto-configured — it has to be wired up explicitly
  // per-invocation from the raw event before getStore() will work.
  connectLambda(event);

  try {
    const store = quotesStore();

    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      if (!qs.ref) return jsonResponse(400, { error: true, message: 'ref is required' });
      const quote = await store.get(qs.ref.toUpperCase(), { type: 'json' });
      if (!quote) return jsonResponse(404, { error: true, message: `No quote found for reference ${qs.ref}` });
      return jsonResponse(200, { data: quote });
    }

    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: true, message: 'GET or POST only' });
    }

    const input = JSON.parse(event.body || '{}');

    if (input.action === 'confirm' || input.action === 'cancel') {
      if (!input.ref) return jsonResponse(400, { error: true, message: 'ref is required' });
      const key = input.ref.toUpperCase();
      const quote = await store.get(key, { type: 'json' });
      if (!quote) return jsonResponse(404, { error: true, message: `No quote found for reference ${input.ref}` });
      quote.status = input.action === 'confirm' ? 'confirmed_by_customer' : 'cancelled';
      quote.updatedAt = new Date().toISOString();
      await store.setJSON(key, quote);
      return jsonResponse(200, { data: quote });
    }

    if (input.action === 'card-verify-result') {
      const { ref, setupIntentId } = input;
      if (!ref) return jsonResponse(400, { error: true, message: 'ref is required' });
      if (!setupIntentId) return jsonResponse(400, { error: true, message: 'setupIntentId is required' });
      const key = ref.toUpperCase();
      const quote = await store.get(key, { type: 'json' });
      if (!quote) return jsonResponse(404, { error: true, message: `No quote found for reference ${ref}` });

      // Authoritative check — re-read the SetupIntent from Stripe's own API
      // rather than trusting whatever the browser tells us.
      const params = new URLSearchParams();
      params.append('expand[]', 'payment_method');
      const si = await stripeRequest(`/setup_intents/${encodeURIComponent(setupIntentId)}`, { method: 'GET', params });

      quote.updatedAt = new Date().toISOString();

      if (si.status !== 'succeeded') {
        quote.status = 'payment_declined';
        quote.paymentDeclineReason = (si.last_setup_error && si.last_setup_error.message) || 'The card could not be verified.';
        await store.setJSON(key, quote);
        return jsonResponse(200, { data: quote, verification: { status: 'declined', reason: quote.paymentDeclineReason } });
      }

      const pm = si.payment_method || {};
      const card = pm.card || {};
      const billingName = (pm.billing_details && pm.billing_details.name) || '';
      quote.cardBrand = card.brand || null;
      quote.cardLast4 = card.last4 || null;
      quote.cardBillingName = billingName || null;

      if (billingName && !namesLikelyMatch(billingName, quote.passenger)) {
        quote.status = 'pending_manual_review';
        await store.setJSON(key, quote);
        return jsonResponse(200, { data: quote, verification: { status: 'needs_review', reason: 'Cardholder name does not match the traveling passenger.' } });
      }

      quote.status = 'card_verified';
      await store.setJSON(key, quote);
      return jsonResponse(200, { data: quote, verification: { status: 'verified' } });
    }

    if (input.action === 'create') {
      // Validate the agent against AGENT_ACCOUNTS (see _agent-auth.js). Fails
      // closed once configured — a bad/missing email+code is rejected rather
      // than silently falling back to a free-text agent name.
      const authResult = findAgent(input.agentEmail, input.agentCode);
      if (authResult.configured && !authResult.agent) {
        return jsonResponse(401, { error: true, message: 'Invalid agent email or access code' });
      }
      const resolvedAgentName = authResult.agent ? authResult.agent.name : (input.agentName || 'Unknown agent');
      const resolvedAgentEmail = authResult.agent ? authResult.agent.email : (input.agentEmail || null);
      const resolvedAgentRole = authResult.agent ? authResult.agent.role : null;

      const { offer, markup, passenger, customerEmail, billingAddress } = input;
      if (!offer || !offer.id || !Array.isArray(offer.slices)) {
        return jsonResponse(400, { error: true, message: 'A valid offer snapshot is required' });
      }
      if (!passenger || !passenger.given_name || !passenger.family_name || !passenger.born_on) {
        return jsonResponse(400, { error: true, message: 'passenger given_name, family_name and born_on are required' });
      }
      if (!customerEmail) {
        return jsonResponse(400, { error: true, message: 'customerEmail is required' });
      }
      if (!billingAddress || !billingAddress.line1 || !billingAddress.city || !billingAddress.country) {
        return jsonResponse(400, { error: true, message: 'billingAddress (line1, city, country) is required' });
      }

      const fareAmount = Number(offer.total_amount);
      const markupAmount = Number(markup) || 0;
      if (markupAmount < 0) return jsonResponse(400, { error: true, message: 'markup cannot be negative' });

      let mtrRef = generateRef();
      // Extremely unlikely, but guard against a collision.
      for (let i = 0; i < 5 && (await store.get(mtrRef, { type: 'json' })); i++) mtrRef = generateRef();

      const quote = {
        mtrRef,
        status: 'pending_verification',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        agentName: resolvedAgentName,
        agentEmail: resolvedAgentEmail,
        agentRole: resolvedAgentRole,
        customerEmail,
        passenger,
        billingAddress,
        offer,
        fareAmount,
        fareCurrency: offer.total_currency,
        markupAmount,
        totalAmount: fareAmount + markupAmount,
        totalCurrency: offer.total_currency,
      };

      await store.setJSON(mtrRef, quote);
      const emailResult = await sendVerificationEmail(quote);

      return jsonResponse(200, { data: quote, email: emailResult });
    }

    return jsonResponse(400, { error: true, message: 'action must be one of "create", "confirm", "cancel", "card-verify-result"' });
  } catch (err) {
    return errorResponse(err);
  }
};
