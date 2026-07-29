/* =========================================================
   VERIFY BOOKING PAGE — customer reviews an agent-built quote,
   confirms the details, then verifies their card via Stripe
   (no charge, no hold — just confirms the card is live) before
   the quote is handed to a human to complete the real booking.
   Card number/expiry/CVV are typed directly into Stripe's own
   hosted Elements widget and never touch our server.
   Relies on shared helpers from duffel-app.js (dflApi, dflFmtMoney,
   dflFmtTime, dflFmtDate).
   ========================================================= */
(function(){
  const root = document.getElementById('verify-booking-root');
  if(!root) return;

  const params = new URLSearchParams(window.location.search);
  const ref = (params.get('ref') || '').toUpperCase();
  if(!ref){
    root.innerHTML = `<div class="dfl-alert dfl-alert-error">No booking reference was provided in this link.</div>`;
    return;
  }

  function fmtDateTime(iso){
    return new Date(iso).toLocaleString('en-US', { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  }

  function billingLine(b){
    if(!b) return '';
    return [b.line1, b.line2, b.city, b.state, b.postal_code, b.country].filter(Boolean).join(', ');
  }

  function reviewHtml(quote){
    const p = quote.passenger;
    const flightsHtml = quote.offer.slices.map(s => {
      const first = s.segments[0], last = s.segments[s.segments.length-1];
      const airline = (first.marketing_carrier && first.marketing_carrier.name) || (quote.offer.owner && quote.offer.owner.name) || 'Airline';
      return `
        <div style="border:1px solid #e6ddc9;border-radius:8px;padding:16px;margin-bottom:12px;">
          <div style="font-size:12px;color:#6f6659;font-weight:600;text-transform:uppercase;letter-spacing:.03em;">${airline}</div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px;">
            <div style="font-size:22px;font-weight:700;">${first.origin.iata_code}</div>
            <div style="color:#6f6659;font-size:12px;">&#9992;</div>
            <div style="font-size:22px;font-weight:700;">${last.destination.iata_code}</div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;color:#6f6659;">
            <div>${dflFmtTime(first.departing_at)}</div>
            <div>${dflFmtTime(last.arriving_at)}</div>
          </div>
          <div style="font-size:12.5px;color:#6f6659;margin-top:6px;">${fmtDateTime(first.departing_at)}</div>
        </div>`;
    }).join('');

    return `
      <div style="background:#ffffff;border:1px solid #e6ddc9;border-radius:10px;padding:24px;">
        <div style="font-size:12px;color:#6f6659;font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin-bottom:14px;">Flight Details</div>
        ${flightsHtml}

        <div style="font-size:12px;color:#6f6659;font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin:18px 0 10px;">Traveler Details</div>
        <div style="border:1px solid #e6ddc9;border-radius:8px;padding:14px 16px;font-size:13.5px;">
          <div style="font-weight:700;">${p.given_name} ${p.family_name}</div>
          <div style="color:#6f6659;margin-top:4px;">Date of birth: ${p.born_on}</div>
          <div style="color:#6f6659;margin-top:2px;">Email: ${p.email || quote.customerEmail}</div>
          <div style="color:#6f6659;margin-top:2px;">Phone: ${p.phone_number}</div>
        </div>

        <div style="font-size:12px;color:#6f6659;font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin:18px 0 10px;">Price Details</div>
        <div style="border:1px solid #e6ddc9;border-radius:8px;padding:14px 16px;font-size:13.5px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span>Base fare</span><span>${dflFmtMoney(quote.fareAmount, quote.fareCurrency)}</span></div>
          <div style="display:flex;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid #e6ddc9;margin-bottom:10px;"><span>Service fee</span><span>${dflFmtMoney(quote.markupAmount, quote.fareCurrency)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:17px;font-weight:800;"><span>Total</span><span>${dflFmtMoney(quote.totalAmount, quote.totalCurrency)}</span></div>
        </div>

        ${quote.billingAddress ? `
        <div style="font-size:12px;color:#6f6659;font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin:18px 0 10px;">Billing Address</div>
        <div style="border:1px solid #e6ddc9;border-radius:8px;padding:14px 16px;font-size:13.5px;">${billingLine(quote.billingAddress)}</div>` : ''}

        <div style="font-size:12px;color:#6f6659;font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin:18px 0 10px;">Terms &amp; Conditions</div>
        <div style="border:1px solid #e6ddc9;border-radius:8px;padding:14px 16px;font-size:12px;color:#6f6659;line-height:1.7;">
          Prices shown are quoted by your travel advisor and are not guaranteed until confirmed and a card is verified. Airline fare rules govern refunds, changes and name-change restrictions once a ticket is issued. By clicking Confirm &amp; Pay you confirm the passenger and itinerary details above are accurate.
        </div>
      </div>`;
  }

  let stripeInstance = null;
  let cardElement = null;
  let currentSetupIntentId = null;

  async function mountCardStep(quote, container){
    container.innerHTML = `<div class="dfl-center"><div class="dfl-spinner"></div><p class="muted mt-8">Preparing secure card entry…</p></div>`;
    let intentRes;
    try {
      intentRes = await dflApi('stripe-setup-intent', { method: 'POST', body: {} });
    } catch(err){
      container.innerHTML = `<div class="dfl-alert dfl-alert-error">Could not start card verification: ${err.message}</div>`;
      return;
    }
    if(!intentRes.publishableKey){
      container.innerHTML = `<div class="dfl-alert dfl-alert-error">Card verification isn't configured yet. Please contact your travel advisor.</div>`;
      return;
    }
    if(typeof Stripe === 'undefined'){
      container.innerHTML = `<div class="dfl-alert dfl-alert-error">Secure payment library failed to load. Please refresh and try again.</div>`;
      return;
    }
    currentSetupIntentId = intentRes.id;
    stripeInstance = Stripe(intentRes.publishableKey);
    const elements = stripeInstance.elements();
    cardElement = elements.create('card', { style: { base: { fontSize: '15px', color: '#1b1712', fontFamily: 'Inter, sans-serif' } } });

    const b = quote.billingAddress || {};
    container.innerHTML = `
      <div style="background:#ffffff;border:1px solid #e6ddc9;border-radius:10px;padding:24px;">
        <div style="font-size:16px;font-weight:700;margin-bottom:4px;">Verify your card</div>
        <p class="muted" style="font-size:12.5px;margin-bottom:16px;">We're only confirming this card is valid — nothing will be charged right now. Your advisor will contact you to complete payment and ticketing.</p>
        <div class="dfl-field" style="margin-bottom:12px;"><label>Name on card</label><input type="text" id="verify-card-name" value="${quote.passenger.given_name} ${quote.passenger.family_name}"></div>
        <div class="dfl-field" style="margin-bottom:6px;"><label>Card details</label><div id="verify-card-element" style="border:1.5px solid #e6ddc9;border-radius:8px;padding:12px 14px;background:#fdfbf6;"></div></div>
        <div id="verify-card-errors" class="dfl-alert dfl-alert-error" style="display:none;"></div>
        <button type="button" class="btn btn-orange mt-16" id="verify-card-submit" style="width:100%;">Verify Card &amp; Submit</button>
      </div>`;
    cardElement.mount('#verify-card-element');

    document.getElementById('verify-card-submit').addEventListener('click', async () => {
      const submitBtn = document.getElementById('verify-card-submit');
      const errorsEl = document.getElementById('verify-card-errors');
      errorsEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Verifying…';

      const billingName = document.getElementById('verify-card-name').value.trim();
      const { setupIntent, error } = await stripeInstance.confirmCardSetup(intentRes.client_secret, {
        payment_method: {
          card: cardElement,
          billing_details: {
            name: billingName,
            email: quote.customerEmail,
            address: {
              line1: b.line1 || undefined,
              line2: b.line2 || undefined,
              city: b.city || undefined,
              state: b.state || undefined,
              postal_code: b.postal_code || undefined,
              country: b.country || undefined,
            },
          },
        },
      });

      if(error){
        errorsEl.textContent = error.message || 'Your card could not be verified.';
        errorsEl.style.display = 'block';
      }

      // Regardless of the client-side outcome, ask our server to re-read the
      // SetupIntent from Stripe directly and record the authoritative result.
      try {
        const res = await dflApi('quotes', {
          method: 'POST',
          body: { action: 'card-verify-result', ref, setupIntentId: (setupIntent && setupIntent.id) || currentSetupIntentId },
        });
        renderOutcome(res.data, res.verification);
      } catch(err){
        errorsEl.textContent = err.message;
        errorsEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Verify Card & Submit';
      }
    });
  }

  function renderOutcome(quote, verification){
    let html = '';
    if(verification.status === 'verified'){
      html = `<div class="dfl-alert dfl-alert-success">
        <b>Card verified.</b> Nothing was charged. Reference <b>${quote.mtrRef}</b> — your travel advisor will now complete the booking and follow up with your e-ticket and final payment.
      </div>`;
    } else if(verification.status === 'needs_review'){
      html = `<div class="dfl-alert dfl-alert-info">
        <b>Almost there.</b> Your card was verified, but the name on the card didn't match the traveler (${quote.passenger.given_name} ${quote.passenger.family_name}). This is normal if someone else is paying — our team will call you shortly to confirm before booking. Reference <b>${quote.mtrRef}</b>.
      </div>`;
    } else {
      html = `<div class="dfl-alert dfl-alert-error">
        <b>Payment declined.</b> ${quote.paymentDeclineReason || 'The card could not be verified.'} You can try a different card below.
      </div>
      <button type="button" class="btn btn-orange mt-16" id="verify-retry-btn">Try a different card</button>`;
    }
    root.innerHTML = html;
    const retryBtn = document.getElementById('verify-retry-btn');
    if(retryBtn) retryBtn.addEventListener('click', () => mountCardStep(quote, root));
  }

  function render(quote){
    let banner = '';
    if(quote.status === 'card_verified') return renderOutcome(quote, { status: 'verified' });
    if(quote.status === 'pending_manual_review') return renderOutcome(quote, { status: 'needs_review' });
    if(quote.status === 'payment_declined') { /* fall through to allow retry from review screen */ }
    if(quote.status === 'cancelled') banner = `<div class="dfl-alert dfl-alert-info">This quote was cancelled.</div>`;

    root.innerHTML = `
      ${banner}
      ${reviewHtml(quote)}
      <div id="verify-action-status" class="mt-16"></div>
      ${quote.status === 'cancelled' ? '' : `
        <div class="dfl-trip-actions mt-16">
          <button type="button" class="btn btn-orange" id="verify-confirm-btn" style="width:100%;">Confirm &amp; Pay</button>
        </div>
        <div class="mt-8" style="text-align:center;">
          <button type="button" class="btn btn-outline btn-sm" id="verify-cancel-btn">Something's wrong — cancel this quote</button>
        </div>
      `}
    `;

    const confirmBtn = document.getElementById('verify-confirm-btn');
    if(confirmBtn) confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true; confirmBtn.textContent = 'Loading…';
      try {
        await dflApi('quotes', { method: 'POST', body: { action: 'confirm', ref } });
        const cardStepContainer = document.createElement('div');
        cardStepContainer.className = 'mt-16';
        root.appendChild(cardStepContainer);
        confirmBtn.parentElement.style.display = 'none';
        const cancelBtn = document.getElementById('verify-cancel-btn');
        if(cancelBtn) cancelBtn.style.display = 'none';
        await mountCardStep(quote, cardStepContainer);
      } catch(err){
        document.getElementById('verify-action-status').innerHTML = `<div class="dfl-alert dfl-alert-error">${err.message}</div>`;
        confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm & Pay';
      }
    });
    const cancelBtn = document.getElementById('verify-cancel-btn');
    if(cancelBtn) cancelBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      try {
        await dflApi('quotes', { method: 'POST', body: { action: 'cancel', ref } });
        document.getElementById('verify-action-status').innerHTML = `<div class="dfl-alert dfl-alert-info">Got it — flagged as incorrect. Please also reply to the email you received so your advisor knows what to fix.</div>`;
        const confirmBtn2 = document.getElementById('verify-confirm-btn');
        if(confirmBtn2) confirmBtn2.parentElement.style.display = 'none';
        cancelBtn.style.display = 'none';
      } catch(err){
        document.getElementById('verify-action-status').innerHTML = `<div class="dfl-alert dfl-alert-error">${err.message}</div>`;
        cancelBtn.disabled = false;
      }
    });
  }

  (async function load(){
    root.innerHTML = `<div class="dfl-center"><div class="dfl-spinner"></div><p class="muted mt-8">Loading your quote…</p></div>`;
    try {
      const res = await dflApi('quotes?ref=' + encodeURIComponent(ref));
      render(res.data);
    } catch(err){
      root.innerHTML = `<div class="dfl-alert dfl-alert-error">${err.message}</div>`;
    }
  })();
})();
