// POST /.netlify/functions/send-quote
// Body: { agentEmail, agentCode, quoteRef, customerEmail, customerName }
// Sends a quotation email via Resend
const { getStore, connectLambda } = require('@netlify/blobs');
const { jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');
const { findAgent } = require('./_agent-auth');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = 'contact@mytravelroyalties.com';

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

async function sendViaResend(to, subject, html) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to,
      subject,
      html,
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${response.status} ${error}`);
  }
  return await response.json();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: true, message: 'POST only' });
  connectLambda(event);

  try {
    const { agentEmail, agentCode, quoteRef, customerEmail, customerName } = JSON.parse(event.body || '{}');
    if (!quoteRef || !customerEmail) return jsonResponse(400, { error: true, message: 'quoteRef and customerEmail required' });

    const auth = findAgent(agentEmail, agentCode);
    if (!auth.configured) return jsonResponse(503, { error: true, message: 'Agent accounts not configured' });
    if (!auth.agent) return jsonResponse(401, { error: true, message: 'Invalid email or access code' });

    if (!RESEND_API_KEY) return jsonResponse(503, { error: true, message: 'Email service not configured' });

    const store = getStore('quotes');
    const quote = await store.get(quoteRef, { type: 'json' });
    if (!quote) return jsonResponse(404, { error: true, message: `Quote ${quoteRef} not found` });

    // Check permission: agent can only send their own quotes, lead can send any
    if (auth.agent.role !== 'lead' && (quote.agentEmail || '').toLowerCase() !== auth.agent.email.toLowerCase()) {
      return jsonResponse(403, { error: true, message: 'Not authorized to send this quote' });
    }

    // Build email HTML
    const { passengers, outbound, return: returnFlight, totalPrice, agentMarkup } = quote;
    const passengerList = (passengers || []).map(p => `${p.given_name} ${p.family_name} (${p.type})`).join(', ');

    const outboundHTML = outbound ? `
      <tr><td colspan="2" style="padding:12px 0; border-bottom:1px solid #eee; font-weight:600; color:#1a1400;">Outbound Flight</td></tr>
      <tr><td>Route:</td><td>${outbound.origin} → ${outbound.destination}</td></tr>
      <tr><td>Date:</td><td>${formatDate(outbound.departure_at)}</td></tr>
      <tr><td>Airlines:</td><td>${outbound.segments.map(s => s.operating_carrier_code).join(', ')}</td></tr>
      <tr><td>Duration:</td><td>${outbound.duration}</td></tr>
    ` : '';

    const returnHTML = returnFlight ? `
      <tr><td colspan="2" style="padding:12px 0; border-bottom:1px solid #eee; font-weight:600; color:#1a1400;">Return Flight</td></tr>
      <tr><td>Route:</td><td>${returnFlight.origin} → ${returnFlight.destination}</td></tr>
      <tr><td>Date:</td><td>${formatDate(returnFlight.departure_at)}</td></tr>
      <tr><td>Airlines:</td><td>${returnFlight.segments.map(s => s.operating_carrier_code).join(', ')}</td></tr>
      <tr><td>Duration:</td><td>${returnFlight.duration}</td></tr>
    ` : '';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #2c2c2c; line-height: 1.5; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #d4af37 0%, #1a1400 100%); color: #fff; padding: 20px; border-radius: 8px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .section { margin: 20px 0; padding: 16px; background: #f9f7f4; border-radius: 8px; }
    .section h2 { margin: 0 0 12px 0; font-size: 16px; color: #1a1400; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 8px 0; }
    td:first-child { width: 140px; font-weight: 500; color: #666; }
    .pricing { background: #fff; border: 2px solid #d4af37; padding: 16px; border-radius: 8px; margin: 20px 0; }
    .price-row { display: flex; justify-content: space-between; padding: 6px 0; }
    .price-total { font-size: 18px; font-weight: 600; color: #1a1400; border-top: 1px solid #eee; padding-top: 10px; }
    .cta { background: #d4af37; color: #1a1400; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block; margin-top: 16px; }
    .footer { text-align: center; color: #999; font-size: 12px; margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px; }
    .agent-info { color: #666; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Your Travel Quotation</h1>
    </div>

    <p>Hi ${customerName || 'Traveler'},</p>
    <p>We're excited to share your personalized flight quotation. Review the details below and let us know if you'd like to proceed!</p>

    <div class="section">
      <h2>Passengers</h2>
      <table><tr><td colspan="2">${passengerList}</td></tr></table>
    </div>

    <div class="section">
      <h2>Flight Details</h2>
      <table>
        ${outboundHTML}
        ${returnHTML}
      </table>
    </div>

    <div class="pricing">
      <div class="price-row"><span>Base Fare:</span><span>${formatCurrency(totalPrice.total_amount)}</span></div>
      ${agentMarkup ? `<div class="price-row"><span>Agent Service:</span><span>${formatCurrency(agentMarkup)}</span></div>` : ''}
      <div class="price-row price-total"><span>Total:</span><span>${formatCurrency(totalPrice.total_amount + (agentMarkup || 0))}</span></div>
    </div>

    <p style="text-align:center;">
      <a href="https://leafy-gnome-cb0c19.netlify.app/agent.html?quote=${quoteRef}" class="cta">View Full Details</a>
    </p>

    <div class="footer">
      <p class="agent-info">Quote Reference: <strong>${quoteRef}</strong></p>
      <p class="agent-info">Prepared by: ${auth.agent.name} • My Travel Royalties</p>
      <p>This quote is valid for 24 hours. Prices are subject to availability.</p>
      <p>© 2026 My Travel Royalties. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `;

    const result = await sendViaResend(customerEmail, `Your Travel Quote – ${quoteRef}`, html);

    return jsonResponse(200, {
      data: {
        success: true,
        quoteRef,
        sentTo: customerEmail,
        messageId: result.id
      }
    });
  } catch (err) {
    return errorResponse(err);
  }
};
