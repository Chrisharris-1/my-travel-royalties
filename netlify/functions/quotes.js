// redeploy-trigger: pick up RESEND_API_KEY env var
// Sales-agent quote system. Nothing here ever calls Duffel's order-creation
// endpoint — it only stores a quote (an offer snapshot + agent markup + the
// passenger details the agent collected) behind our own "MTR-XXXXXX"
// reference, and emails the customer a link to review it before anyone
// creates a real, ticketed order. Turning a confirmed quote into a real
// Duffel order is a deliberate separate step, not part of this file.
//
// POST { action: "create", offer, markup, passenger, customerEmail, agentName, agentCode }
//   -> stores a quote, generates MTR-XXXXXX, best-effort emails the customer
// GET  ?ref=MTR-XXXXXX
//   -> fetch a quote by reference (used by My Trips + the verification page)
// POST { action: "confirm", ref }
//   -> customer has reviewed and approved the quote
// POST { action: "cancel", ref }
//   -> customer (or agent) flags the quote as not to proceed
const { getStore, connectLambda } = require('@netlify/blobs');
const { jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

const REF_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L — avoids confusion when read aloud

function generateRef() {
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_CHARS[Math.floor(Math.random() * REF_CHARS.length)];
  return `MTR-${s}`;
}

function quotesStore() {
  return getStore('quotes');
}

async function sendVerificationEmail(quote) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, reason: 'RESEND_API_KEY is not set — quote was created but no email was sent.' };
  }
  const from = process.env.QUOTE_EMAIL_FROM || 'My Travel Royalties <onboarding@resend.dev>';
  const verifyUrl = `https://mytravelroyalties.com/verify-booking.html?ref=${encodeURIComponent(quote.mtrRef)}`;
  const p = quote.passenger;
  const slicesHtml = quote.offer.slices
    .map((s) => {
      const first = s.segments[0];
      const last = s.segments[s.segments.length - 1];
      return `<div style="margin:10px 0;padding:12px 14px;border:1px solid #e6ddc9;border-radius:8px;">
        <b>${first.origin.iata_code} &rarr; ${last.destination.iata_code}</b><br/>
        <span style="color:#6f6659;font-size:13px;">${new Date(first.departing_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} &mdash; arrives ${new Date(last.arriving_at).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
      </div>`;
    })
    .join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1b1712;">
      <h2 style="color:#1c1712;">Please review your flight before we book it</h2>
      <p>Your travel advisor has put together the flight below. Nothing has been booked yet — please check every detail carefully, especially the passenger name, since it must match your government ID exactly.</p>
      ${slicesHtml}
      <div style="margin:16px 0;padding:14px;background:#f7f3ea;border-radius:8px;">
        <div><b>Passenger:</b> ${p.given_name} ${p.family_name}</div>
        <div><b>Date of birth:</b> ${p.born_on}</div>
        <div><b>Email:</b> ${p.email}</div>
        <div><b>Phone:</b> ${p.phone_number}</div>
      </div>
      <div style="margin:16px 0;font-size:20px;font-weight:700;">Total: ${quote.totalCurrency} ${Number(quote.totalAmount).toFixed(2)}</div>
      <p><a href="${verifyUrl}" style="display:inline-block;background:#C6A15B;color:#0c0906;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:6px;">Review &amp; Confirm This Booking</a></p>
      <p style="color:#6f6659;font-size:12.5px;">Reference: ${quote.mtrRef}. If anything above is incorrect — especially the spelling of the name — do not confirm; reply to this email instead.</p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: quote.customerEmail,
        subject: `Please confirm your flight — ${quote.offer.slices[0].segments[0].origin.iata_code} to ${quote.offer.slices[0].segments[quote.offer.slices[0].segments.length - 1].destination.iata_code} (${quote.mtrRef})`,
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

    if (input.action === 'create') {
      const requiredAgentCode = process.env.AGENT_ACCESS_CODE;
      if (requiredAgentCode && input.agentCode !== requiredAgentCode) {
        return jsonResponse(401, { error: true, message: 'Invalid agent access code' });
      }
      const { offer, markup, passenger, customerEmail, agentName } = input;
      if (!offer || !offer.id || !Array.isArray(offer.slices)) {
        return jsonResponse(400, { error: true, message: 'A valid offer snapshot is required' });
      }
      if (!passenger || !passenger.given_name || !passenger.family_name || !passenger.born_on) {
        return jsonResponse(400, { error: true, message: 'passenger given_name, family_name and born_on are required' });
      }
      if (!customerEmail) {
        return jsonResponse(400, { error: true, message: 'customerEmail is required' });
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
        agentName: agentName || 'Unknown agent',
        customerEmail,
        passenger,
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

    return jsonResponse(400, { error: true, message: 'action must be one of "create", "confirm", "cancel"' });
  } catch (err) {
    return errorResponse(err);
  }
};
