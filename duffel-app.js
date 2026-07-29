/* =========================================================
   MY TRAVEL ROYALTIES — live Duffel integration
   Real flight search, real booking, real order management.
   Talks to the Netlify Functions under /api/* (see netlify.toml).
   ========================================================= */

async function dflApi(path, opts){
  opts = opts || {};
  const res = await fetch('/api/' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch(e){ json = {}; }
  if(!res.ok || json.error){
    const detailMsgs = (json.details && Array.isArray(json.details.errors))
      ? json.details.errors.map(e => e.message).filter(Boolean).join(' ')
      : '';
    const err = new Error(detailMsgs || json.message || ('Request failed (' + res.status + ')'));
    err.raw = json;
    throw err;
  }
  return json;
}

function dflFmtMoney(amount, currency){
  const n = Number(amount);
  if(Number.isNaN(n)) return amount + ' ' + currency;
  try {
    return new Intl.NumberFormat('en-US', { style:'currency', currency: currency || 'USD', maximumFractionDigits: 2 }).format(n);
  } catch(e){
    return '$' + n.toFixed(2) + ' ' + currency;
  }
}

function dflParseDurationMins(iso){
  if(!iso) return 0;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso);
  if(!m) return 0;
  return (parseInt(m[1]||'0',10) * 60) + parseInt(m[2]||'0',10);
}

function dflFmtDuration(mins){
  const h = Math.floor(mins/60), m = mins % 60;
  return h + 'h ' + m + 'm';
}

function dflFmtTime(iso){
  if(!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
}

function dflFmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
}

/* =========================================================
   AIRPORT AUTOCOMPLETE — reusable on any input+suggest pair
   ========================================================= */
function dflWireAirportAutocomplete(inputEl, listEl){
  if(!inputEl || !listEl) return;
  let debounce = null;
  inputEl.addEventListener('input', () => {
    const q = inputEl.value.trim();
    inputEl.dataset.code = '';
    if(debounce) clearTimeout(debounce);
    if(q.length < 2){ listEl.style.display = 'none'; return; }
    debounce = setTimeout(async () => {
      try {
        const res = await dflApi('reference-data?type=places&query=' + encodeURIComponent(q));
        const places = (res.data || []).filter(p => p.iata_code).slice(0, 8);
        if(!places.length){ listEl.style.display = 'none'; return; }
        listEl.innerHTML = places.map(p => `
          <div class="dfl-suggest-item" data-code="${p.iata_code}" data-label="${(p.city_name || p.name)} (${p.iata_code})">
            <b>${p.city_name || p.name} (${p.iata_code})</b>
            <span>${p.name}${p.iata_country_code ? ', ' + p.iata_country_code : ''}</span>
          </div>
        `).join('');
        listEl.style.display = 'block';
        listEl.querySelectorAll('.dfl-suggest-item').forEach(item => {
          item.addEventListener('click', () => {
            inputEl.value = item.dataset.label;
            inputEl.dataset.code = item.dataset.code;
            listEl.style.display = 'none';
          });
        });
      } catch(e){ listEl.style.display = 'none'; }
    }, 300);
  });
  document.addEventListener('click', (e) => {
    if(e.target !== inputEl && !listEl.contains(e.target)) listEl.style.display = 'none';
  });
}

function dflAirportCode(inputEl){
  if(inputEl.dataset.code) return inputEl.dataset.code;
  const m = /\(([A-Za-z]{3})\)/.exec(inputEl.value);
  return m ? m[1].toUpperCase() : '';
}

/* =========================================================
   FLIGHTS PAGE — real search + real booking
   ========================================================= */
(function(){
  const resultsEl = document.getElementById('flight-results');
  if(!resultsEl) return;

  const statusEl = document.getElementById('flight-status');
  const fromInput = document.getElementById('from-input');
  const toInput = document.getElementById('to-input');
  const departInput = document.getElementById('depart-input');
  const returnInput = document.getElementById('return-input');
  const updateBtn = document.getElementById('update-search-btn');
  const sortSelect = document.getElementById('sort-select');
  const priceSlider = document.getElementById('price-range');
  const priceLabel = document.getElementById('price-range-label');
  const stopInputs = document.querySelectorAll('input[name="stops"]');
  const cabinInputs = document.querySelectorAll('input[name="cabin"]');
  const airlineGroup = document.getElementById('airline-filter-group');
  const airlineList = document.getElementById('airline-filter-list');
  const headingEl = document.getElementById('flights-heading');
  const subheadingEl = document.getElementById('flights-subheading');
  const resultCountEl = document.getElementById('result-count');

  dflWireAirportAutocomplete(fromInput, document.getElementById('from-suggest'));
  dflWireAirportAutocomplete(toInput, document.getElementById('to-suggest'));

  let lastOffers = [];

  function offerStops(offer){
    return Math.max(...offer.slices.map(s => s.segments.length - 1));
  }
  function offerDurationMins(offer){
    return offer.slices.reduce((sum, s) => sum + dflParseDurationMins(s.duration), 0);
  }
  function offerStopsLabel(n){
    return n === 0 ? 'Nonstop' : (n === 1 ? '1 stop' : n + ' stops');
  }

  function currentStopFilter(){
    const checked = Array.from(stopInputs).find(i => i.checked);
    return checked ? checked.value : 'any';
  }
  function currentAirlineFilter(){
    return Array.from(airlineList.querySelectorAll('input:checked')).map(i => i.value);
  }

  function renderOffers(){
    const maxPrice = priceSlider ? Number(priceSlider.value) : Infinity;
    const stopFilter = currentStopFilter();
    const airlineFilter = currentAirlineFilter();
    let rows = lastOffers.filter(o => {
      const price = Number(o.total_amount);
      const stops = offerStops(o);
      const stopsLabel = offerStopsLabel(stops);
      if(price > maxPrice) return false;
      if(stopFilter !== 'any' && stopsLabel !== stopFilter) return false;
      if(airlineFilter.length && !airlineFilter.includes(o.owner.name)) return false;
      return true;
    });
    const sortBy = sortSelect ? sortSelect.value : 'price';
    if(sortBy === 'price') rows.sort((a,b) => Number(a.total_amount) - Number(b.total_amount));
    if(sortBy === 'duration') rows.sort((a,b) => offerDurationMins(a) - offerDurationMins(b));

    resultCountEl.textContent = rows.length;
    resultsEl.innerHTML = rows.length ? rows.map(o => {
      const slicesHtml = o.slices.map(s => {
        const first = s.segments[0], last = s.segments[s.segments.length-1];
        const stops = s.segments.length - 1;
        return `<div class="result-route">${first.origin.iata_code} ${dflFmtTime(first.departing_at)} → ${last.destination.iata_code} ${dflFmtTime(last.arriving_at)} · ${dflFmtDuration(dflParseDurationMins(s.duration))} · ${offerStopsLabel(stops)} · ${dflFmtDate(first.departing_at)}</div>`;
      }).join('');
      return `
      <div class="result-card">
        <div>
          <div class="result-airline">${o.owner.name}</div>
          ${slicesHtml}
          <div class="result-tags">
            <span class="pill pill-blue">${o.conditions && o.conditions.refund_before_departure && o.conditions.refund_before_departure.allowed ? 'Refundable' : 'Non-refundable'}</span>
            <span class="pill pill-green">${o.conditions && o.conditions.change_before_departure && o.conditions.change_before_departure.allowed ? 'Changes allowed' : 'No changes'}</span>
          </div>
        </div>
        <div class="result-price-block">
          <div class="result-price">${dflFmtMoney(o.total_amount, o.total_currency)}</div>
          <div class="muted" style="font-size:12px;">total, ${o.passengers.length} traveler${o.passengers.length>1?'s':''}</div>
          <button type="button" class="btn btn-orange btn-sm mt-12" data-offer-id="${o.id}">Select</button>
        </div>
      </div>
    `;
    }).join('') : `<p class="muted center" style="padding:40px 0;">No flights match these filters — try widening your price range or changing the search.</p>`;

    resultsEl.querySelectorAll('[data-offer-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const offer = lastOffers.find(o => o.id === btn.dataset.offerId);
        if(offer) openBookingModal(offer);
      });
    });
  }

  function populateAirlineFilter(){
    const names = Array.from(new Set(lastOffers.map(o => o.owner.name))).sort();
    if(!names.length){ airlineGroup.style.display = 'none'; return; }
    airlineGroup.style.display = 'block';
    airlineList.innerHTML = names.map(n => `<label class="check-row"><span><input type="checkbox" value="${n}" checked> ${n}</span></label>`).join('');
    airlineList.querySelectorAll('input').forEach(i => i.addEventListener('change', renderOffers));
  }

  function setupPriceSlider(){
    if(!lastOffers.length || !priceSlider) return;
    const prices = lastOffers.map(o => Number(o.total_amount));
    const min = Math.floor(Math.min(...prices));
    const max = Math.ceil(Math.max(...prices));
    priceSlider.min = min;
    priceSlider.max = max;
    priceSlider.value = max;
    if(priceLabel) priceLabel.textContent = dflFmtMoney(max, lastOffers[0].total_currency);
  }

  async function runSearch(){
    const originCode = dflAirportCode(fromInput);
    const destCode = dflAirportCode(toInput);
    if(!originCode || !destCode){
      statusEl.innerHTML = `<div class="dfl-alert dfl-alert-error">Please choose airports from the suggestion list (or use the "City (CODE)" format) for both From and To.</div>`;
      return;
    }
    const departDate = departInput.value;
    const returnDate = returnInput.value;
    const cabin = (Array.from(cabinInputs).find(i => i.checked) || {}).value || 'economy';

    if(headingEl) headingEl.textContent = 'Flights to ' + destCode;
    if(subheadingEl) subheadingEl.textContent = `${originCode} → ${destCode} · ${departDate}${returnDate ? ' – ' + returnDate : ''} · 1 traveler · ${cabin.replace('_',' ')}`;

    statusEl.innerHTML = `<div class="dfl-center"><div class="dfl-spinner"></div><p class="muted mt-8">Searching live fares…</p></div>`;
    resultsEl.innerHTML = '';
    airlineGroup.style.display = 'none';

    const slices = [{ origin: originCode, destination: destCode, departure_date: departDate }];
    if(returnDate){ slices.push({ origin: destCode, destination: originCode, departure_date: returnDate }); }

    lastOffers = [];

    // Live NDC/GDS searches across many airlines routinely take 10-30s, which exceeds a
    // single serverless function's execution window. So we create the offer request
    // WITHOUT waiting for offers (fast), then poll the offers list a few times as Duffel
    // streams results in from each airline — this avoids gateway timeouts and gives the
    // user progressively-appearing real results, same pattern Duffel recommends.
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
        setupPriceSlider();
        populateAirlineFilter();
        renderOffers();
        if(lastOffers.length && i < maxPolls - 1){
          statusEl.innerHTML = `<div class="dfl-alert dfl-alert-info">${lastOffers.length} live fare${lastOffers.length>1?'s':''} found — still checking a few more airlines…</div>`;
        }
      }
      statusEl.innerHTML = lastOffers.length ? '' : `<div class="dfl-alert dfl-alert-info">No live offers found for this route/date — try different dates or airports.</div>`;
    } catch(e){
      statusEl.innerHTML = `<div class="dfl-alert dfl-alert-error">Search failed: ${e.message}</div>`;
      resultCountEl.textContent = '0';
    }
  }

  if(updateBtn) updateBtn.addEventListener('click', runSearch);
  if(sortSelect) sortSelect.addEventListener('change', renderOffers);
  if(priceSlider) priceSlider.addEventListener('input', () => { renderOffers(); if(priceLabel) priceLabel.textContent = dflFmtMoney(priceSlider.value, (lastOffers[0]||{}).total_currency || 'USD'); });
  stopInputs.forEach(i => i.addEventListener('change', renderOffers));

  /* ---------- booking modal ---------- */
  const modal = document.getElementById('booking-modal');
  const modalBody = document.getElementById('booking-modal-body');
  const modalClose = document.getElementById('booking-modal-close');
  if(modalClose) modalClose.addEventListener('click', () => modal.style.display = 'none');
  if(modal) modal.addEventListener('click', (e) => { if(e.target === modal) modal.style.display = 'none'; });

  function openBookingModal(offer){
    const requiresInstant = !offer.payment_requirements || offer.payment_requirements.requires_instant_payment !== false;
    const slicesSummary = offer.slices.map(s => {
      const first = s.segments[0], last = s.segments[s.segments.length-1];
      return `<div>${first.origin.iata_code} → ${last.destination.iata_code} · ${dflFmtDate(first.departing_at)}, ${dflFmtTime(first.departing_at)}</div>`;
    }).join('');

    modalBody.innerHTML = `
      <h3>Book this flight</h3>
      <p class="muted" style="font-size:13px;">${offer.owner.name} · ${offer.passengers.length} traveler${offer.passengers.length>1?'s':''}</p>
      <div class="dfl-order-summary">
        ${slicesSummary}
        <div style="margin-top:8px; font-weight:700;">Total: ${dflFmtMoney(offer.total_amount, offer.total_currency)}</div>
      </div>
      <div class="dfl-alert dfl-alert-info">This creates a <b>real order</b> with the airline via Duffel using live production credentials. Fill in the lead traveler's details exactly as they appear on their government ID.</div>
      <form id="dfl-passenger-form">
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
          <div class="dfl-field"><label>Email</label><input type="email" name="email" required placeholder="you@example.com"></div>
        </div>
        <div class="dfl-field-row">
          <div class="dfl-field" style="grid-column:1/-1;"><label>Phone (with country code)</label><input name="phone_number" required placeholder="+14155550123"></div>
        </div>
        ${requiresInstant ? `
          <div class="dfl-alert dfl-alert-info" style="margin-top:16px;">This fare requires payment at booking. Selecting "Book &amp; Pay Now" will charge the connected Duffel account balance <b>${dflFmtMoney(offer.total_amount, offer.total_currency)}</b> and issue real tickets.</div>
        ` : `
          <div class="dfl-field" style="margin-top:16px;">
            <label style="display:flex; align-items:center; gap:8px; text-transform:none; font-size:13px;">
              <input type="checkbox" name="pay_now" style="width:auto;"> Pay now instead of holding the reservation
            </label>
          </div>
        `}
        <div id="dfl-booking-error"></div>
        <button type="submit" class="btn btn-orange mt-16" style="width:100%;">${requiresInstant ? 'Book & Pay Now' : 'Reserve Flight'}</button>
      </form>
    `;
    modal.style.display = 'flex';

    document.getElementById('dfl-passenger-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      const payNow = requiresInstant || fd.get('pay_now') === 'on';
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Processing…';
      document.getElementById('dfl-booking-error').innerHTML = '';

      const passenger = {
        id: offer.passengers[0].id,
        title: fd.get('title'),
        gender: fd.get('gender'),
        given_name: fd.get('given_name'),
        family_name: fd.get('family_name'),
        born_on: fd.get('born_on'),
        email: fd.get('email'),
        phone_number: fd.get('phone_number'),
      };

      try {
        const body = {
          selectedOfferId: offer.id,
          passengers: [passenger],
          paymentType: payNow ? 'balance' : 'hold',
        };
        if(payNow){ body.amount = offer.total_amount; body.currency = offer.total_currency; }
        const res = await dflApi('orders', { method: 'POST', body });
        const order = res.data;
        modalBody.innerHTML = `
          <h3>Booking confirmed</h3>
          <div class="dfl-alert dfl-alert-success">
            <div><b>Booking reference:</b> ${order.booking_reference}</div>
            <div><b>Status:</b> ${payNow ? 'Ticketed / paid' : 'Held — payment required before ' + (order.payment_status && order.payment_status.payment_required_by ? new Date(order.payment_status.payment_required_by).toLocaleString() : 'the airline deadline')}</div>
          </div>
          <p class="muted" style="font-size:13.5px;">Look this trip up any time on <a href="your-office.html" style="color:var(--orange); font-weight:700;">My Trips</a> using booking reference <b>${order.booking_reference}</b>.</p>
          <button type="button" class="btn btn-outline mt-16" style="width:100%;" id="dfl-modal-done">Done</button>
        `;
        document.getElementById('dfl-modal-done').addEventListener('click', () => modal.style.display = 'none');
      } catch(err){
        document.getElementById('dfl-booking-error').innerHTML = `<div class="dfl-alert dfl-alert-error">${err.message}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = requiresInstant ? 'Book & Pay Now' : 'Reserve Flight';
      }
    });
  }

  runSearch();
})();

/* =========================================================
   MY TRIPS PAGE — real order lookup, cancel, change
   ========================================================= */
(function(){
  const lookupForm = document.getElementById('trip-lookup-form');
  if(!lookupForm) return;

  const refInput = document.getElementById('trip-lookup-input');
  const resultEl = document.getElementById('trip-lookup-result');
  const params = new URLSearchParams(window.location.search);
  if(params.get('ref')) refInput.value = params.get('ref');

  function renderOrder(order){
    const segmentsHtml = order.slices.map(s => {
      const first = s.segments[0], last = s.segments[s.segments.length-1];
      return `<div class="dfl-segment">
        <b>${first.origin.iata_code} → ${last.destination.iata_code}</b>
        <div class="muted" style="font-size:13px; margin-top:4px;">${dflFmtDate(first.departing_at)} · ${dflFmtTime(first.departing_at)} – ${dflFmtTime(last.arriving_at)} · ${s.segments.length-1 === 0 ? 'Nonstop' : (s.segments.length-1) + ' stop(s)'}</div>
      </div>`;
    }).join('');
    const passengersHtml = order.passengers.map(p => `${p.given_name} ${p.family_name}`).join(', ');

    resultEl.innerHTML = `
      <div class="result-card" style="grid-template-columns:1fr;">
        <div>
          <div class="result-airline">Booking ${order.booking_reference}</div>
          <div class="muted" style="font-size:13px; margin:4px 0 10px;">${passengersHtml} · ${order.total_amount ? dflFmtMoney(order.total_amount, order.total_currency) : ''}</div>
          ${segmentsHtml}
          <div id="trip-action-status"></div>
          <div class="dfl-trip-actions">
            <button type="button" class="btn btn-outline btn-sm" id="trip-cancel-btn">Cancel Trip</button>
            <button type="button" class="btn btn-outline btn-sm" id="trip-change-btn">Request Date Change</button>
          </div>
          <div id="trip-change-panel" style="display:none; margin-top:14px;"></div>
        </div>
      </div>
    `;

    document.getElementById('trip-cancel-btn').addEventListener('click', () => startCancellation(order));
    document.getElementById('trip-change-btn').addEventListener('click', () => startChangeFlow(order));
  }

  async function startCancellation(order){
    const statusEl = document.getElementById('trip-action-status');
    statusEl.innerHTML = `<div class="dfl-center"><div class="dfl-spinner"></div><p class="muted mt-8">Getting cancellation quote…</p></div>`;
    try {
      const res = await dflApi('order-cancellations', { method: 'POST', body: { orderId: order.id } });
      const quote = res.data;
      statusEl.innerHTML = `
        <div class="dfl-alert dfl-alert-info">
          Refund amount: <b>${dflFmtMoney(quote.refund_amount, quote.refund_currency)}</b>.
          This cannot be undone.
        </div>
        <button type="button" class="btn btn-orange btn-sm" id="trip-cancel-confirm-btn">Confirm Cancellation</button>
      `;
      document.getElementById('trip-cancel-confirm-btn').addEventListener('click', async () => {
        statusEl.innerHTML = `<div class="dfl-center"><div class="dfl-spinner"></div><p class="muted mt-8">Cancelling…</p></div>`;
        try {
          await dflApi('order-cancellations', { method: 'POST', body: { confirmId: quote.id } });
          statusEl.innerHTML = `<div class="dfl-alert dfl-alert-success">Trip cancelled. Refund of ${dflFmtMoney(quote.refund_amount, quote.refund_currency)} has been initiated.</div>`;
        } catch(err){
          statusEl.innerHTML = `<div class="dfl-alert dfl-alert-error">Cancellation failed: ${err.message}</div>`;
        }
      });
    } catch(err){
      statusEl.innerHTML = `<div class="dfl-alert dfl-alert-error">Couldn't get a cancellation quote: ${err.message}</div>`;
    }
  }

  function startChangeFlow(order){
    const panel = document.getElementById('trip-change-panel');
    panel.style.display = 'block';
    const firstSlice = order.slices[0];
    panel.innerHTML = `
      <div class="dfl-field-row">
        <div class="dfl-field"><label>New departure date</label><input type="date" id="dfl-change-date"></div>
      </div>
      <button type="button" class="btn btn-outline btn-sm mt-8" id="dfl-change-search-btn">Find Change Options</button>
      <div id="dfl-change-status"></div>
    `;
    document.getElementById('dfl-change-search-btn').addEventListener('click', async () => {
      const newDate = document.getElementById('dfl-change-date').value;
      const statusEl = document.getElementById('dfl-change-status');
      if(!newDate){ statusEl.innerHTML = `<div class="dfl-alert dfl-alert-error">Choose a new date first.</div>`; return; }
      statusEl.innerHTML = `<div class="dfl-center"><div class="dfl-spinner"></div><p class="muted mt-8">Requesting change options…</p></div>`;
      try {
        const reqRes = await dflApi('order-changes', {
          method: 'POST',
          body: { step: 'request', orderId: order.id, slices: { add: [{ origin: firstSlice.segments[0].origin.iata_code, destination: firstSlice.segments[firstSlice.segments.length-1].destination.iata_code, departure_date: newDate }], remove: [{ slice_id: firstSlice.id }] } },
        });
        const changeRequestId = reqRes.data.id;
        const offersRes = await dflApi('order-changes', { method: 'POST', body: { step: 'offers', changeRequestId } });
        const changeOffers = offersRes.data || [];
        if(!changeOffers.length){
          statusEl.innerHTML = `<div class="dfl-alert dfl-alert-info">No change options available for that date.</div>`;
          return;
        }
        statusEl.innerHTML = changeOffers.slice(0, 5).map(co => `
          <div class="dfl-segment">
            <div>New total: ${dflFmtMoney(co.new_total_amount, co.new_total_currency)}</div>
            <div class="muted" style="font-size:12px;">Change fee: ${dflFmtMoney(co.change_total_amount, co.change_total_currency)}</div>
            <button type="button" class="btn btn-orange btn-sm mt-8" data-change-offer-id="${co.id}">Confirm This Change</button>
          </div>
        `).join('');
        statusEl.querySelectorAll('[data-change-offer-id]').forEach(btn => {
          btn.addEventListener('click', async () => {
            btn.disabled = true; btn.textContent = 'Confirming…';
            try {
              await dflApi('order-changes', { method: 'POST', body: { step: 'confirm', changeOfferId: btn.dataset.changeOfferId } });
              statusEl.innerHTML = `<div class="dfl-alert dfl-alert-success">Change confirmed. Your itinerary has been updated.</div>`;
            } catch(err){
              statusEl.innerHTML = `<div class="dfl-alert dfl-alert-error">Change failed: ${err.message}</div>`;
            }
          });
        });
      } catch(err){
        statusEl.innerHTML = `<div class="dfl-alert dfl-alert-error">${err.message}</div>`;
      }
    });
  }

  function renderQuote(quote){
    const segmentsHtml = quote.offer.slices.map(s => {
      const first = s.segments[0], last = s.segments[s.segments.length-1];
      return `<div class="dfl-segment">
        <b>${first.origin.iata_code} → ${last.destination.iata_code}</b>
        <div class="muted" style="font-size:13px; margin-top:4px;">${dflFmtDate(first.departing_at)} · ${dflFmtTime(first.departing_at)} – ${dflFmtTime(last.arriving_at)}</div>
      </div>`;
    }).join('');
    const p = quote.passenger;
    const statusMeta = {
      pending_verification: { label: 'Awaiting your confirmation', pill: 'pill-orange' },
      confirmed_by_customer: { label: 'Confirmed — verifying card', pill: 'pill-blue' },
      card_verified: { label: 'Card verified — being booked by your advisor', pill: 'pill-green' },
      pending_manual_review: { label: 'Needs a quick call to verify', pill: 'pill-orange' },
      payment_declined: { label: 'Payment declined', pill: 'pill-orange' },
      cancelled: { label: 'Cancelled', pill: 'pill-blue' },
    }[quote.status] || { label: quote.status, pill: 'pill-blue' };

    const verifyUrl = 'verify-booking.html?ref=' + encodeURIComponent(quote.mtrRef);
    const showReviewLink = quote.status === 'pending_verification' || quote.status === 'payment_declined';

    resultEl.innerHTML = `
      <div class="result-card" style="grid-template-columns:1fr;">
        <div>
          <div class="result-airline">Quote ${quote.mtrRef} <span class="pill ${statusMeta.pill}" style="margin-left:8px;">${statusMeta.label}</span></div>
          <div class="muted" style="font-size:13px; margin:4px 0 10px;">${p.given_name} ${p.family_name} · ${dflFmtMoney(quote.totalAmount, quote.totalCurrency)}</div>
          ${segmentsHtml}
          ${quote.status === 'payment_declined' ? `<div class="dfl-alert dfl-alert-error">${quote.paymentDeclineReason || 'The card could not be verified.'}</div>` : ''}
          ${quote.status === 'pending_manual_review' ? `<div class="dfl-alert dfl-alert-info">Your card was verified, but the name on the card didn't match the traveler. Our team will call you to confirm before booking.</div>` : ''}
          ${showReviewLink ? `<div class="dfl-trip-actions"><a class="btn btn-orange btn-sm" href="${verifyUrl}">${quote.status === 'payment_declined' ? 'Try a different card' : 'Review & Confirm'}</a></div>` : ''}
        </div>
      </div>
    `;
  }

  lookupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ref = refInput.value.trim();
    if(!ref) return;
    resultEl.innerHTML = `<div class="dfl-center"><div class="dfl-spinner"></div><p class="muted mt-8">Looking up your trip…</p></div>`;

    if(ref.toUpperCase().startsWith('MTR-')){
      try {
        const res = await dflApi('quotes?ref=' + encodeURIComponent(ref.toUpperCase()));
        renderQuote(res.data);
      } catch(err){
        resultEl.innerHTML = `<div class="dfl-alert dfl-alert-info">No quote found for reference "${ref}".</div>`;
      }
      return;
    }

    try {
      const res = await dflApi('orders?booking_reference=' + encodeURIComponent(ref));
      const orders = res.data || [];
      if(!orders.length){
        resultEl.innerHTML = `<div class="dfl-alert dfl-alert-info">No trip found for reference "${ref}". Double check the booking reference from your confirmation.</div>`;
        return;
      }
      renderOrder(orders[0]);
    } catch(err){
      resultEl.innerHTML = `<div class="dfl-alert dfl-alert-error">Lookup failed: ${err.message}</div>`;
    }
  });

  if(params.get('ref')) lookupForm.dispatchEvent(new Event('submit'));
})();
