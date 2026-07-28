// POST /.netlify/functions/orders   -> create a real booking
// GET  /.netlify/functions/orders?id=ord_xxx  -> fetch one order
// GET  /.netlify/functions/orders  -> list orders (booking_reference, awaiting_payment, etc filters)
//
// POST body:
// {
//   selectedOfferId, passengers: [{id, title, given_name, family_name, gender, born_on,
//     email, phone_number, ...}],
//   paymentType: "balance" | "hold",   // "balance" pays instantly from Duffel Balance,
//                                       // "hold" reserves the order for pay-later (needs a
//                                       // follow-up call to /payments before the hold expires)
//   amount, currency   // required for "balance" payment type — must match the offer total
// }
const { duffelRequest, jsonResponse, errorResponse, handleOptions } = require('./_duffel-client');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  try {
    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      if (qs.id) {
        const result = await duffelRequest(`/air/orders/${qs.id}`);
        return jsonResponse(200, result);
      }
      const result = await duffelRequest('/air/orders', {
        query: {
          booking_reference: qs.booking_reference,
          awaiting_payment: qs.awaiting_payment,
          limit: qs.limit || '50',
          after: qs.after,
        },
      });
      return jsonResponse(200, result);
    }

    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: true, message: 'GET or POST only' });
    }

    const input = JSON.parse(event.body || '{}');
    const { selectedOfferId, passengers, paymentType = 'hold', amount, currency } = input;

    if (!selectedOfferId) {
      return jsonResponse(400, { error: true, message: 'selectedOfferId is required' });
    }
    if (!Array.isArray(passengers) || !passengers.length) {
      return jsonResponse(400, { error: true, message: 'passengers[] is required' });
    }
    if (paymentType === 'balance' && (!amount || !currency)) {
      return jsonResponse(400, {
        error: true,
        message: 'amount and currency are required when paymentType is "balance"',
      });
    }

    const body = {
      type: paymentType === 'balance' ? 'instant' : 'hold',
      selected_offers: [selectedOfferId],
      passengers: passengers.map((p) => ({
        id: p.id,
        title: p.title,
        gender: p.gender,
        given_name: p.givenName || p.given_name,
        family_name: p.familyName || p.family_name,
        born_on: p.bornOn || p.born_on,
        email: p.email,
        phone_number: p.phoneNumber || p.phone_number,
        ...(p.identityDocuments || p.identity_documents
          ? { identity_documents: p.identityDocuments || p.identity_documents }
          : {}),
        ...(p.loyaltyProgrammeAccounts || p.loyalty_programme_accounts
          ? {
              loyalty_programme_accounts:
                p.loyaltyProgrammeAccounts || p.loyalty_programme_accounts,
            }
          : {}),
      })),
      ...(paymentType === 'balance'
        ? { payments: [{ type: 'balance', amount, currency }] }
        : {}),
    };

    const result = await duffelRequest('/air/orders', { method: 'POST', body });
    return jsonResponse(200, result);
  } catch (err) {
    return errorResponse(err);
  }
};
