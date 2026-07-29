/* =========================================================
   MY TRAVEL ROYALTIES — Agent Portal
   Search live fares, add a markup, generate an MTR quote and
   email the customer to verify before anything is ever booked.
   Also: per-agent login, Log a Call/Lead, Sale Form, Quotes list,
   and Team Chat.
   Relies on the shared helpers defined in duffel-app.js
   (dflApi, dflFmtMoney, dflFmtTime, dflFmtDate, dflFmtDuration,
   dflParseDurationMins, dflWireAirportAutocomplete, dflAirportCode).
   ========================================================= */
(function(){
  const shellGate = document.getElementById('agent-gate');
  const shell = document.getElementById('agent-shell');
  if(!shellGate || !shell) return;

  let agentName = '';
  let agentEmail = '';
  let agentCode = '';
  let agentRole = 'agent';

  async function callFn(name, body){
    const res = await fetch('/.netlify/functions/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => ({}));
    if(!res.ok || json.error) throw new Error((json && json.message) || `Request to ${name} failed`);
    return json;
  }

  document.getElementById('agent-gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById('agent-email-input');
    const codeInput = document.getElementById('agent-code-input');
    const errorEl = document.getElementById('agent-gate-error');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    try {
      const res = await callFn('agent-login', { email: emailInput.value.trim(), code: codeInput.value.trim() });
      agentName = res.data.name;
      agentEmail = res.data.email;
      agentCode = codeInput.value.trim();
      agentRole = res.data.role || 'agent';

      document.getElementById('agent-name-pill').textContent = agentName;
      const rolePill = document.getElementById('agent-role-pill');
      if(agentRole === 'lead'){
        rolePill.style.display = 'inline-flex';
        document.getElementById('leads-list-heading').textContent = 'Team Leads';
        document.getElementById('quotes-list-heading').textContent = 'Team Quotes';
        document.getElementById('sales-list-heading').textContent = 'Team Sales';
      }
      shellGate.style.display = 'none';
      shell.style.display = 'block';
      initRosterAndChat();
      refreshLeads();
      refreshSales();
      refreshQuotes();
    } catch(err){
      errorEl.textContent = err.message || 'Sign-in failed.';
      errorEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enter Agent Portal';
    }
  });

  /* ---------- tabs ---------- */
  document.querySelectorAll('.agent-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.agent-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.agent-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.querySelector(`.agent-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    });
  });

  /* =========================================================
     FLIGHTS / QUOTE BUILDER (live Duffel search)
     ========================================================= */
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
      const logoUrl = o.owner && o.owner.logo_symbol_url;
      return `
      <div class="result-card">
        <div>
          <div class="result-airline">
            ${logoUrl ? `<img src="${logoUrl}" alt="${o.owner.name}" class="airline-logo" onerror="this.style.display='none'">` : ''}
            <span>${o.owner.name}</span>
          </div>
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

  /* ---------- send quote modal ---------- */
  const sendQuoteModal = document.getElementById('send-quote-modal');
  const sendQuoteForm = document.getElementById('send-quote-form');
  const sendQuoteStatus = document.getElementById('send-quote-status');
  document.getElementById('send-quote-modal-close').addEventListener('click', () => sendQuoteModal.style.display = 'none');
  sendQuoteModal.addEventListener('click', (e) => { if(e.target === sendQuoteModal) sendQuoteModal.style.display = 'none'; });

  sendQuoteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const quoteRef = sendQuoteForm.dataset.quoteRef;
    const custEmail = document.getElementById('send-quote-email').value.trim();
    const custName = document.getElementById('send-quote-name').value.trim();
    const submitBtn = sendQuoteForm.querySelector('button[type="submit"]');

    if(!custEmail) { sendQuoteStatus.innerHTML = '<div class="dfl-alert dfl-alert-error">Customer email required</div>'; return; }

    sendQuoteStatus.innerHTML = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    try {
      await callFn('send-quote', {
        agentEmail,
        agentCode,
        quoteRef,
        customerEmail: custEmail,
        customerName: custName
      });
      sendQuoteStatus.innerHTML = '<div class="dfl-alert dfl-alert-success">Quote sent successfully!</div>';
      setTimeout(() => { sendQuoteModal.style.display = 'none'; }, 1500);
    } catch(err) {
      sendQuoteStatus.innerHTML = `<div class="dfl-alert dfl-alert-error">${err.message}</div>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Quote';
    }
  });

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
        <h3 class="mt-16" style="font-size:15px;">Billing address (for card verification)</h3>
        <div class="dfl-field-row">
          <div class="dfl-field" style="grid-column:1/-1;"><label>Address line 1</label><input name="billing_line1" required placeholder="2782 Sapphire Desert Drive"></div>
        </div>
        <div class="dfl-field-row">
          <div class="dfl-field"><label>City</label><input name="billing_city" required placeholder="Henderson"></div>
          <div class="dfl-field"><label>State / Province</label><input name="billing_state" placeholder="NV"></div>
        </div>
        <div class="dfl-field-row">
          <div class="dfl-field"><label>Postal code</label><input name="billing_postal_code" placeholder="89052"></div>
          <div class="dfl-field"><label>Country (2-letter code)</label><input name="billing_country" required placeholder="US" maxlength="2" style="text-transform:uppercase;"></div>
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

      const billingAddress = {
        line1: fd.get('billing_line1'),
        city: fd.get('billing_city'),
        state: fd.get('billing_state') || undefined,
        postal_code: fd.get('billing_postal_code') || undefined,
        country: (fd.get('billing_country') || '').toUpperCase(),
      };

      try {
        const res = await dflApi('quotes', {
          method: 'POST',
          body: {
            action: 'create',
            offer,
            markup: Number(fd.get('markup')) || 0,
            passenger,
            billingAddress,
            customerEmail: fd.get('customerEmail'),
            agentEmail,
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
        document.getElementById('agent-quote-done').addEventListener('click', () => { modal.style.display = 'none'; refreshQuotes(); });
      } catch(err){
        document.getElementById('agent-quote-error').innerHTML = `<div class="dfl-alert dfl-alert-error">${err.message}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Quote & Email Customer';
      }
    });
  }

  /* =========================================================
     LOG A CALL / LEAD
     ========================================================= */
  const leadForm = document.getElementById('lead-form');
  const leadStatus = document.getElementById('lead-form-status');
  leadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = leadForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
    leadStatus.innerHTML = '';
    try {
      await callFn('leads', {
        action: 'create',
        agentEmail, agentCode,
        customerName: document.getElementById('lead-name-input').value,
        customerPhone: document.getElementById('lead-phone-input').value,
        customerEmail: document.getElementById('lead-email-input').value,
        interest: document.getElementById('lead-interest-input').value,
        outcome: document.getElementById('lead-outcome-select').value,
        followUpDate: document.getElementById('lead-followup-input').value,
        notes: document.getElementById('lead-notes-input').value,
      });
      leadStatus.innerHTML = `<div class="dfl-alert dfl-alert-success">Lead saved.</div>`;
      leadForm.reset();
      refreshLeads();
    } catch(err){
      leadStatus.innerHTML = `<div class="dfl-alert dfl-alert-error">${err.message}</div>`;
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Save Lead';
    }
  });

  const OUTCOME_LABELS = { interested:'Interested', booked:'Booked', not_interested:'Not interested', follow_up_needed:'Needs follow-up', no_answer:'No answer' };
  async function refreshLeads(){
    const host = document.getElementById('leads-list');
    try {
      const res = await callFn('agent-leads', { email: agentEmail, code: agentCode });
      const leads = res.data || [];
      host.innerHTML = leads.length ? leads.map(l => `
        <div class="lead-row">
          <div><b>${l.customerName}</b><div class="muted">${l.customerPhone || l.customerEmail || ''}</div></div>
          <div>${l.interest || '—'}</div>
          <div><span class="pill pill-blue">${OUTCOME_LABELS[l.outcome] || l.outcome}</span>${agentRole==='lead' ? `<div class="muted mt-8">${l.agentName}</div>` : ''}</div>
          <div class="muted">${new Date(l.createdAt).toLocaleDateString()}</div>
        </div>
      `).join('') : `<p class="muted center" style="padding:24px 0;">No leads logged yet.</p>`;
    } catch(err){
      host.innerHTML = `<div class="dfl-alert dfl-alert-error">${err.message}</div>`;
    }
  }

  /* =========================================================
     SALE FORM
     ========================================================= */
  const saleForm = document.getElementById('sale-form');
  const saleStatus = document.getElementById('sale-form-status');
  saleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = saleForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
    saleStatus.innerHTML = '';
    try {
      await callFn('sales', {
        action: 'create',
        agentEmail, agentCode,
        customerName: document.getElementById('sale-name-input').value,
        customerEmail: document.getElementById('sale-email-input').value,
        customerPhone: document.getElementById('sale-phone-input').value,
        productType: document.getElementById('sale-product-select').value,
        saleAmount: document.getElementById('sale-amount-input').value,
        commission: document.getElementById('sale-commission-input').value,
        saleDate: document.getElementById('sale-date-input').value,
        notes: document.getElementById('sale-notes-input').value,
      });
      saleStatus.innerHTML = `<div class="dfl-alert dfl-alert-success">Sale saved.</div>`;
      saleForm.reset();
      refreshSales();
    } catch(err){
      saleStatus.innerHTML = `<div class="dfl-alert dfl-alert-error">${err.message}</div>`;
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Save Sale';
    }
  });

  async function refreshSales(){
    const host = document.getElementById('sales-list');
    try {
      const res = await callFn('agent-sales', { email: agentEmail, code: agentCode });
      const sales = res.data || [];
      host.innerHTML = sales.length ? sales.map(s => `
        <div class="quote-row">
          <div><b>${s.customerName}</b><div class="muted">${s.productType}</div></div>
          <div>$${Number(s.saleAmount).toLocaleString('en-US')}</div>
          <div>${agentRole==='lead' ? s.agentName : (s.commission != null ? 'Commission: $' + s.commission : '')}</div>
          <div class="muted">${s.saleDate}</div>
        </div>
      `).join('') : `<p class="muted center" style="padding:24px 0;">No sales logged yet.</p>`;
    } catch(err){
      host.innerHTML = `<div class="dfl-alert dfl-alert-error">${err.message}</div>`;
    }
  }

  /* =========================================================
     QUOTES LIST
     ========================================================= */
  async function refreshQuotes(){
    const host = document.getElementById('quotes-list');
    try {
      const res = await callFn('agent-quotes', { email: agentEmail, code: agentCode });
      const quotes = res.data || [];
      host.innerHTML = quotes.length ? quotes.map(q => `
        <div class="quote-row">
          <div><b>${q.mtrRef}</b><div class="muted">${q.customerEmail}</div></div>
          <div>${dflFmtMoney(q.totalAmount, q.totalCurrency)}</div>
          <div><span class="pill pill-blue">${q.status.replace(/_/g,' ')}</span>${agentRole==='lead' ? `<div class="muted mt-8">${q.agentName}</div>` : ''}</div>
          <div><button type="button" class="quote-send-btn" data-ref="${q.mtrRef}" data-customer-email="${q.customerEmail}" style="font-size:12px; padding:4px 8px; background:var(--gold); color:#1a1400; border:none; border-radius:4px; cursor:pointer; font-weight:600;">Send</button></div>
        </div>
      `).join('') : `<p class="muted center" style="padding:24px 0;">No quotes yet.</p>`;
      host.querySelectorAll('.quote-send-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const modal = document.getElementById('send-quote-modal');
          const ref = btn.dataset.ref;
          const custEmail = btn.dataset.customerEmail;
          document.getElementById('send-quote-email').value = custEmail;
          document.getElementById('send-quote-name').value = '';
          document.getElementById('send-quote-status').innerHTML = '';
          document.getElementById('send-quote-form').dataset.quoteRef = ref;
          modal.style.display = 'flex';
        });
      });
    } catch(err){
      host.innerHTML = `<div class="dfl-alert dfl-alert-error">${err.message}</div>`;
    }
  }

  /* =========================================================
     TEAM CHAT
     ========================================================= */
  let currentChannel = 'team';
  let chatPollTimer = null;

  function renderChannelList(roster){
    const listEl = document.getElementById('chat-channel-list');
    const others = roster.filter(a => a.email.toLowerCase() !== agentEmail.toLowerCase());
    const dmTargets = agentRole === 'lead' ? others : others.filter(a => a.role === 'lead');
    listEl.innerHTML = `<button type="button" class="chat-channel active" data-channel="team">Team Chat<span class="sub">Everyone</span></button>` +
      dmTargets.map(a => `<button type="button" class="chat-channel" data-channel="${a.email}">${a.name}<span class="sub">${a.role === 'lead' ? 'Team Lead' : 'Direct message'}</span></button>`).join('');
    listEl.querySelectorAll('.chat-channel').forEach(btn => {
      btn.addEventListener('click', () => {
        listEl.querySelectorAll('.chat-channel').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentChannel = btn.dataset.channel;
        loadChat();
      });
    });
  }

  function renderMessages(messages){
    const host = document.getElementById('chat-messages');
    host.innerHTML = messages.map(m => `
      <div class="chat-msg ${m.fromEmail.toLowerCase() === agentEmail.toLowerCase() ? 'mine' : ''}">
        <div>${m.text.replace(/</g,'&lt;')}</div>
        <div class="meta">${m.fromName} · ${new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
      </div>
    `).join('');
    host.scrollTop = host.scrollHeight;
  }

  async function loadChat(){
    try {
      const res = await callFn('chat-messages', { agentEmail, agentCode, channel: currentChannel });
      renderMessages(res.data || []);
    } catch(err){
      document.getElementById('chat-messages').innerHTML = `<div class="dfl-alert dfl-alert-error">${err.message}</div>`;
    }
  }

  async function initRosterAndChat(){
    try {
      const res = await callFn('chat-messages', { agentEmail, agentCode, channel: 'team' });
      renderChannelList(res.roster || []);
      renderMessages(res.data || []);
    } catch(err){
      document.getElementById('chat-messages').innerHTML = `<div class="dfl-alert dfl-alert-error">${err.message}</div>`;
    }
    if(chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = setInterval(loadChat, 4000);
  }

  document.getElementById('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if(!text) return;
    input.value = '';
    try {
      await callFn('chat-send', { agentEmail, agentCode, channel: currentChannel, text });
      loadChat();
    } catch(err){
      alert(err.message);
    }
  });
})();
