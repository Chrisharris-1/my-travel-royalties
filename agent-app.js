/* =========================================================
   MY TRAVEL ROYALTIES — Agent Portal
   Search live fares, add a markup, generate an MTR quote and
   email the customer to verify before anything is ever booked.
   Relies on the shared helpers defined in duffel-app.js
   (dflApi, dflFmtMoney, dflFmtTime, dflFmtDate, dflFmtDuration,
   dflParseDurationMins, dflWireAirportAutocomplete, dflAirportCode).
   ========================================================= */
(function(){
  const shellGate = document.getElementById('agent-gate');
  const shell = document.getElementById('agent-shell');
  if(!shellGate || !shell) return;

  let agentName = '';
  let agentCode = '';

  document.getElementById('agent-gate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    agentName = document.getElementById('agent-name-input').value.trim();
    agentCode = document.getElementById('agent-code-input').value;
    if(!agentName) return;
    document.getElementById('agent-name-pill').textContent = agentName;
    shellGate.style.display = 'none';
    shell.style.display = 'block';
  });

  const fromInput = document.getElementById('agent-from-input');
  const toInput = document.getElementById('agent-to-input');
  const departInput = document.getElementById('agent-depart-input');
  const returnInput = document.getElementById('agent-return-input');
  const cabinSelect = document.getElementById('agent-cabin-select');
  const searchBtn = document.getElementById('agent-search-btn');
  const statusEl = document.getElementById('agent-flight-status');
  const resultsEl = document.getElementById('agent-flight-results');

  dflWireAirportAutocomplete(fromInput, document.getElementById('agent-from-suggest'));
  dflWireAirportAutocomplete(toInput, document.getElementById('agent-to-suggest'));

  let lastOffers = [];

  function renderResults(){
    const sorted = [...lastOffers].sort((a,b) => Number(a.total_amount) - Number(b.total_amount));
    resultsEl.innerHTML = sorted.length ? sorted.map(o => {
      const slicesHtml = o.slices.map(s => {
        const first = s.segments[0], last = s.segments[s.segments.length-1];
        const stops = s.segments.length - 1;
        return `<div class="result-route">${first.origin.iata_code} ${dflFmtTime(first.departing_at)} → ${last.destination.iata_code} ${dflFmtTime(last.arriving_at)} · ${dflFmtDuration(dflParseDurationMins(s.duration))} · ${stops === 0 ? 'Nonstop' : stops + ' stop(s)'} · ${dflFmtDate(first.departing_at)}</div>`;
      }).join('');
      return `
      <div class="result-card">
        <div>
          <div class="result-airline">${o.owner.name}</div>
          ${slicesHtml}
        </div>
        <div class="result-price-block">
          <div class="result-price">${dflFmtMoney(o.total_amount, o.total_currency)}</div>
          <div class="muted" style="font-size:12px;">real-time fare, ${o.passengers.length} traveler${o.passengers.length>1?'s':''}</div>
          <button type="button" class="btn btn-orange btn-sm mt-12" data-offer-id="${o.id}">Create Quote</button>
        </div>
      </div>`;
    }).join('') : '';

    resultsEl.querySelectorAll('[data-offer-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const offer = lastOffers.find(o => o.id === btn.dataset.offerId);
        if(offer) openQuoteModal(offer);
      });
    });
  }

  async function runSearch(){
    const originCode = dflAirportCode(fromInput);
    const destCode = dflAirportCode(toInput);
    if(!originCode || !destCode){
      statusEl.innerHTML = `<div class="dfl-alert dfl-alert-error">Choose airports from the suggestion list for both From and To.</div>`;
      return;
    }
    const departDate = departInput.value;
    const returnDate = returnInput.value;
    const cabin = cabinSelect.value;

    statusEl.innerHTML = `<div class="dfl-center"><div class="dfl-spinner"></div><p class="muted mt-8">Searching live fares…</p></div>`;
    resultsEl.innerHTML = '';
    lastOffers = [];

    const slices = [{ origin: originCode, destination: destCode, departure_date: departDate }];
    if(returnDate){ slices.push({ origin: destCode, destination: originCode, departure_date: returnDate }); }

    try {
      const createRes = await dflApi('offer-requests', {
        method: 'POST',
        body: { slices, passengers: [{ type: 'adult' }], cabinClass: cabin, returnOffers: false },
      });
      const offerRequestId = createRes.data.id;
      const maxPolls = 7;
      for(let i = 0; i < maxPolls; i++){
        await new Promise(r => setTimeout(r, i === 0 ? 1500 : 2500));
        try {
          const offersRes = await dflApi('offers?offer_request_id=' + encodeURIComponent(offerRequestId) + '&limit=50');
          lastOffers = offersRes.data || [];
        } catch(pollErr){ continue; }
        renderResults();
        if(lastOffers.length && i < maxPolls - 1){
          statusEl.innerHTML = `<div class="dfl-alert dfl-alert-info">${lastOffers.length} live fare${lastOffers.length>1?'s':''} found — still checking a few more airlines…</div>`;
        }
      }
      statusEl.innerHTML = lastOffers.length ? '' : `<div class="dfl-alert dfl-alert-info">No live offers found — try different dates or airports.</div>`;
    } catch(e){
      statusEl.innerHTML = `<div class="dfl-alert dfl-alert-error">Search failed: ${e.message}</div>`;
    }
  }
  searchBtn.addEventListener('click', runSearch);

  /* ---------- quote modal ---------- */
  const modal = document.getElementById('agent-quote-modal');
  const modalBody = document.getElementById('agent-quote-modal-body');
  document.getElementById('agent-quote-modal-close').addEventListener('click', () => modal.style.display = 'none');
  modal.addEventListener('click', (e) => { if(e.target === modal) modal.style.display = 'none'; });

  function openQuoteModal(offer){
    const slicesSummary = offer.slices.map(s => {
      const first = s.segments[0], last = s.segments[s.segments.length-1];
      return `<div>${first.origin.iata_code} → ${last.destination.iata_code} · ${dflFmtDate(first.departing_at)}, ${dflFmtTime(first.departing_at)}</div>`;
    }).join('');

    modalBody.innerHTML = `
      <h3>Build a quote</h3>
      <p class="muted" style="font-size:13px;">${offer.owner.name} · Fare: ${dflFmtMoney(offer.total_amount, offer.total_currency)}</p>
      <div class="dfl-order-summary">${slicesSummary}</div>
      <form id="agent-quote-form">
        <div class="dfl-field-row">
          <div class="dfl-field"><label>Your markup (${offer.total_currency})</label><input type="number" min="0" step="0.01" name="markup" id="agent-markup-input" value="0" required></div>
          <div class="dfl-field"><label>Total customer pays</label><input type="text" id="agent-total-display" readonly value="${dflFmtMoney(offer.total_amount, offer.total_currency)}" style="font-weight:700;"></div>
        </div>
        <h3 class="mt-16" style="font-size:15px;">Passenger (must match government ID)</h3>
        <div class="dfl-field-row">
          <div class="dfl-field"><label>Title</label><select name="title" required><option value="mr">Mr</option><option value="mrs">Mrs</option><option value="ms">Ms</option><option value="miss">Miss</option></select></div>
          <div class="dfl-field"><label>Gender</label><select name="gender" required><option value="m">Male</option><option value="f">Female</option></select></div>
        </div>
        <div class="dfl-field-row">
          <div class="dfl-field"><label>Given name</label><input name="given_name" required placeholder="John"></div>
          <div class="dfl-field"><label>Family name</label><input name="family_name" required placeholder="Appleseed"></div>
        </div>
        <div class="dfl-field-row">
          <div class="dfl-field"><label>Date of birth</label><input type="date" name="born_on" required></div>
          <div class="dfl-field"><label>Passenger phone</label><input name="phone_number" required placeholder="+14155550123"></div>
        </div>
        <h3 class="mt-16" style="font-size:15px;">Send verification to</h3>
        <div class="dfl-field-row">
          <div class="dfl-field" style="grid-column:1/-1;"><label>Customer email</label><input type="email" name="customerEmail" required placeholder="customer@example.com"></div>
        </div>
        <div id="agent-quote-error"></div>
        <button type="submit" class="btn btn-orange mt-16" style="width:100%;">Create Quote &amp; Email Customer</button>
      </form>
    `;
    modal.style.display = 'flex';

    const markupInput = document.getElementById('agent-markup-input');
    const totalDisplay = document.getElementById('agent-total-display');
    markupInput.addEventListener('input', () => {
      const markup = Number(markupInput.value) || 0;
      totalDisplay.value = dflFmtMoney(Number(offer.total_amount) + markup, offer.total_currency);
    });

    document.getElementById('agent-quote-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating quote…';
      document.getElementById('agent-quote-error').innerHTML = '';

      const passenger = {
        id: offer.passengers[0].id,
        title: fd.get('title'),
        gender: fd.get('gender'),
        given_name: fd.get('given_name'),
        family_name: fd.get('family_name'),
        born_on: fd.get('born_on'),
        email: fd.get('customerEmail'),
        phone_number: fd.get('phone_number'),
      };

      try {
        const res = await dflApi('quotes', {
          method: 'POST',
          body: {
            action: 'create',
            offer,
            markup: Number(fd.get('markup')) || 0,
            passenger,
            customerEmail: fd.get('customerEmail'),
            agentName,
            agentCode,
          },
        });
        const quote = res.data;
        const verifyUrl = window.location.origin + '/verify-booking.html?ref=' + encodeURIComponent(quote.mtrRef);
        modalBody.innerHTML = `
          <h3>Quote created</h3>
          <div class="dfl-alert dfl-alert-success">
            <div><b>Reference:</b> ${quote.mtrRef}</div>
            <div><b>Total quoted to customer:</b> ${dflFmtMoney(quote.totalAmount, quote.totalCurrency)}</div>
          </div>
          ${res.email && res.email.sent
            ? `<div class="dfl-alert dfl-alert-success">Verification email sent to ${quote.customerEmail}.</div>`
            : `<div class="dfl-alert dfl-alert-error">Email was NOT sent (${(res.email && res.email.reason) || 'no email service configured'}). Share this link with the customer directly:</div>`
          }
          <div class="dfl-field"><label>Verification link</label><input type="text" readonly value="${verifyUrl}" onclick="this.select()"></div>
          <button type="button" class="btn btn-outline mt-16" style="width:100%;" id="agent-quote-done">Done</button>
        `;
        document.getElementById('agent-quote-done').addEventListener('click', () => { modal.style.display = 'none'; });
      } catch(err){
        document.getElementById('agent-quote-error').innerHTML = `<div class="dfl-alert dfl-alert-error">${err.message}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Quote & Email Customer';
      }
    });
  }
})();
