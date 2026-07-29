/* =========================================================
   MY TRAVEL ROYALTIES — OTA interactivity
   ========================================================= */

/* =========================================================
   PHOTO CAROUSEL — auto-rotating crossfade with dot nav
   Works on any .carousel containing .carousel-slide children.
   Add data-interval="4500" to override the default timing.
   ========================================================= */
document.querySelectorAll('.carousel').forEach(carousel => {
  const slides = Array.from(carousel.querySelectorAll('.carousel-slide'));
  if(slides.length < 2) { if(slides[0]) slides[0].classList.add('active'); return; }
  let idx = 0;
  slides[0].classList.add('active');

  let dotsWrap = null;
  if(carousel.dataset.dots !== 'off'){
    dotsWrap = document.createElement('div');
    dotsWrap.className = 'carousel-dots';
    slides.forEach((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      if(i === 0) b.classList.add('active');
      b.addEventListener('click', () => go(i));
      dotsWrap.appendChild(b);
    });
    carousel.appendChild(dotsWrap);
  }

  function go(next){
    slides[idx].classList.remove('active');
    if(dotsWrap) dotsWrap.children[idx].classList.remove('active');
    idx = next;
    slides[idx].classList.add('active');
    if(dotsWrap) dotsWrap.children[idx].classList.add('active');
  }

  const interval = parseInt(carousel.dataset.interval || '4500', 10);
  let timer = setInterval(() => go((idx + 1) % slides.length), interval);
  carousel.addEventListener('mouseenter', () => clearInterval(timer));
  carousel.addEventListener('mouseleave', () => { timer = setInterval(() => go((idx + 1) % slides.length), interval); });
});

/* ---------- mobile menu ---------- */
const burger = document.querySelector('.nav-burger');
const mobileMenu = document.querySelector('.mobile-menu');
if(burger && mobileMenu){
  burger.addEventListener('click', () => mobileMenu.classList.add('open'));
  mobileMenu.querySelectorAll('a, .mobile-close').forEach(el =>
    el.addEventListener('click', () => mobileMenu.classList.remove('open'))
  );
}

/* =========================================================
   HOME — search tabs (Flights / Hotels / Cars / Packages)
   ========================================================= */
const searchTabs = document.querySelectorAll('.search-tab');
const searchPanels = document.querySelectorAll('.search-panel');
if(searchTabs.length){
  searchTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      searchTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.mode;
      searchPanels.forEach(p => p.style.display = (p.dataset.panel === mode) ? 'block' : 'none');
    });
  });
}

/* redirect helpers so the homepage search actually lands you on the right results page */
document.querySelectorAll('[data-go-flights]').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); window.location.href = 'flights.html'; }));
document.querySelectorAll('[data-go-hotels]').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); window.location.href = 'hotels.html'; }));
document.querySelectorAll('[data-go-cars]').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); window.location.href = 'cars.html'; }));
document.querySelectorAll('[data-go-deals]').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); window.location.href = 'deals.html'; }));

/* =========================================================
   FLIGHTS — now powered by the live Duffel API.
   See duffel-app.js for real search/booking logic.
   ========================================================= */
function fmtUSD(n){ return '$' + Math.round(n).toLocaleString('en-US'); }

/* =========================================================
   HOTELS — now powered by the live LiteAPI (Nuitee Connect) API.
   Search calls netlify/functions/stays-search.js, which resolves the
   destination to a Place ID and pulls real-time hotel rates.
   ========================================================= */
const hotelResults = document.getElementById('hotel-results');
if(hotelResults){
  const destInput = document.getElementById('stay-destination-input');
  const checkinInput = document.getElementById('stay-checkin-input');
  const checkoutInput = document.getElementById('stay-checkout-input');
  const guestsSelect = document.getElementById('stay-guests-select');
  const updateBtn = document.getElementById('stay-update-search-btn');
  const statusHost = hotelResults;
  const hPrice = document.getElementById('hotel-price-range');
  const hPriceLabel = document.getElementById('hotel-price-label');
  const starInputs = document.querySelectorAll('input[name="stars"]');

  let lastHotels = []; // normalized rows from the most recent live search

  function stars(n){ n = Math.round(n || 0); return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5-n)); }
  function fmtMoney(amount, currency){
    const n = Number(amount);
    if(!isFinite(n)) return '—';
    return (currency === 'USD' ? '$' : (currency || '') + ' ') + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  // LiteAPI's /hotels/rates response shape can vary slightly by account
  // config, so this pulls out whichever fields are present rather than
  // assuming one exact shape.
  function normalizeHotel(h){
    const cheapestRoom = (h.roomTypes || []).flatMap(rt => rt.rates || []).sort((a,b) =>
      (Number(a.retailRate && a.retailRate.total && a.retailRate.total[0] && a.retailRate.total[0].amount) || Infinity) -
      (Number(b.retailRate && b.retailRate.total && b.retailRate.total[0] && b.retailRate.total[0].amount) || Infinity)
    )[0];
    const total = cheapestRoom && cheapestRoom.retailRate && cheapestRoom.retailRate.total && cheapestRoom.retailRate.total[0];
    const hotelData = h.hotelData || h;
    return {
      hotelId: h.hotelId || hotelData.id,
      name: hotelData.name || h.name || 'Hotel',
      starRating: hotelData.starRating || hotelData.rating || 0,
      photo: hotelData.main_photo || hotelData.thumbnail || (hotelData.hotelImages && hotelData.hotelImages[0] && hotelData.hotelImages[0].url) || '',
      address: (hotelData.address || hotelData.city || ''),
      price: total ? Number(total.amount) : null,
      currency: total ? total.currency : 'USD',
      refundable: !!(cheapestRoom && (cheapestRoom.cancellationPolicies || cheapestRoom.refundableTag === 'RFN')),
      boardName: cheapestRoom && cheapestRoom.boardName,
      offerId: cheapestRoom && (cheapestRoom.offerId || cheapestRoom.rateId),
    };
  }

  function currentMinStars(){
    const checked = Array.from(starInputs).filter(i => i.checked).map(i => Number(i.value));
    return checked.length ? Math.min(...checked) : 0;
  }

  function renderRows(){
    const maxPrice = hPrice ? Number(hPrice.value) : 100000;
    const minStars = currentMinStars();
    const rows = lastHotels.filter(h => (h.price == null || h.price <= maxPrice) && h.starRating >= minStars);
    hotelResults.innerHTML = rows.length ? rows.map(h => `
      <div class="hotel-card">
        <div class="hotel-img photo-img" style="background-image:url('${h.photo || 'https://loremflickr.com/300/260/hotel,room'}');"></div>
        <div class="hotel-body">
          <div class="stars">${stars(h.starRating)}</div>
          <h3 class="h3 mt-8">${h.name}</h3>
          <div class="muted" style="font-size:13px; margin-top:4px;">${h.address || ''}</div>
          <div class="result-tags mt-12">
            ${h.refundable ? '<span class="pill pill-green">Free cancellation</span>' : ''}
            ${h.boardName ? `<span class="pill pill-blue">${h.boardName}</span>` : ''}
          </div>
        </div>
        <div class="hotel-side">
          <div class="result-price">${h.price != null ? fmtMoney(h.price, h.currency) : 'See rates'}</div>
          <div class="muted" style="font-size:12px;">total stay</div>
          <button class="btn btn-orange btn-sm" data-offer-id="${h.offerId || ''}" data-hotel-name="${h.name.replace(/"/g,'&quot;')}" onclick="window.__stayPrebook(this)">View Rooms</button>
        </div>
      </div>
    `).join('') : `<p class="muted center" style="padding:40px 0;">No hotels match these filters — try widening your search.</p>`;
    document.getElementById('hotel-count').textContent = rows.length;
  }

  async function runSearch(){
    const guestParts = (guestsSelect && guestsSelect.value ? guestsSelect.value : '2,1,1').split(',').map(Number);
    const [adults, children, rooms] = guestParts;
    const checkin = checkinInput ? checkinInput.value : '';
    const checkout = checkoutInput ? checkoutInput.value : '';
    const destination = destInput ? destInput.value.trim() : '';

    const headingEl = document.getElementById('stays-heading');
    const subEl = document.getElementById('stays-subheading');
    if(headingEl) headingEl.textContent = `Hotels in ${destination}`;
    if(subEl && checkin && checkout) subEl.textContent = `${checkin} – ${checkout} · ${adults} adult(s), ${rooms} room(s)`;

    statusHost.innerHTML = `<p class="muted center" style="padding:40px 0;">Searching live rates…</p>`;
    document.getElementById('hotel-count').textContent = '—';

    try {
      const res = await fetch('/.netlify/functions/stays-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination, checkin, checkout, adults, children, rooms, currency: 'USD', guestNationality: 'US' }),
      });
      const json = await res.json();
      if(!res.ok || json.error){
        hotelResults.innerHTML = `<div class="dfl-alert dfl-alert-error">${(json && json.message) || 'Could not load live hotel rates right now.'}</div>`;
        document.getElementById('hotel-count').textContent = '0';
        return;
      }
      lastHotels = (json.data || []).map(normalizeHotel);
      renderRows();
    } catch(err){
      hotelResults.innerHTML = `<div class="dfl-alert dfl-alert-error">Network error reaching the hotel search service. ${err.message || ''}</div>`;
      document.getElementById('hotel-count').textContent = '0';
    }
  }

  if(hPrice) hPrice.addEventListener('input', () => { if(hPriceLabel) hPriceLabel.textContent = fmtUSD(hPrice.value); renderRows(); });
  starInputs.forEach(i => i.addEventListener('change', renderRows));
  if(updateBtn) updateBtn.addEventListener('click', runSearch);

  runSearch();
}

/* ---------- "View Rooms" -> live prebook confirmation ---------- */
window.__stayPrebook = async function(btn){
  const offerId = btn.getAttribute('data-offer-id');
  const hotelName = btn.getAttribute('data-hotel-name');
  if(!offerId){
    alert('No bookable rate is attached to this listing yet.');
    return;
  }
  const original = btn.textContent;
  btn.textContent = 'Checking…';
  btn.disabled = true;
  try {
    const res = await fetch('/.netlify/functions/stays-prebook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offerId }),
    });
    const json = await res.json();
    if(!res.ok || json.error){
      alert((json && json.message) || 'This rate is no longer available — try another hotel or search again.');
      return;
    }
    const data = json.data || json;
    const total = data.price != null ? data.price : (data.totalPrice || (data.rate && data.rate.retailRate && data.rate.retailRate.total && data.rate.retailRate.total[0].amount));
    const currency = data.currency || (data.rate && data.rate.retailRate && data.rate.retailRate.total && data.rate.retailRate.total[0].currency) || 'USD';
    alert(`${hotelName}\n\nRate confirmed and available.\nTotal: ${currency} ${total}\n\nprebookId: ${data.prebookId}\n\nGuest details + payment collection is the next step to wire up before this can be turned into a confirmed reservation.`);
  } catch(err){
    alert('Network error confirming this rate. Please try again.');
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
};

/* =========================================================
   DEALS — countdown timers
   ========================================================= */
document.querySelectorAll('.deal-timer').forEach(timer => {
  const end = Date.now() + (parseInt(timer.dataset.hours || '36', 10) * 3600 * 1000);
  function tick(){
    const diff = Math.max(0, end - Date.now());
    const h = String(Math.floor(diff / 3600000)).padStart(2,'0');
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2,'0');
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2,'0');
    timer.innerHTML = `<div class="box">${h}</div><div class="box">${m}</div><div class="box">${s}</div>`;
  }
  tick();
  setInterval(tick, 1000);
});

/* =========================================================
   MEMBERSHIP — Black application stepper
   ========================================================= */
const appSteps = document.querySelectorAll('.app-step');
const stepDots = document.querySelectorAll('.step-dot');
let currentAppStep = 0;
function showAppStep(n){
  appSteps.forEach((s,i) => s.classList.toggle('active', i===n));
  stepDots.forEach((d,i) => d.classList.toggle('active', i<=n));
  currentAppStep = n;
}
document.querySelectorAll('[data-next-step]').forEach(btn => {
  btn.addEventListener('click', () => { if(currentAppStep < appSteps.length - 1) showAppStep(currentAppStep + 1); });
});
document.querySelectorAll('[data-prev-step]').forEach(btn => {
  btn.addEventListener('click', () => { if(currentAppStep > 0) showAppStep(currentAppStep - 1); });
});
if(appSteps.length) showAppStep(0);

/* =========================================================
   SCROLL REVEAL — fade + rise sections and card grids in as
   they enter the viewport. Respects prefers-reduced-motion.
   ========================================================= */
(function(){
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const targets = document.querySelectorAll('.reveal, .reveal-stagger');
  if(!targets.length) return;
  if(prefersReduced){ targets.forEach(t => t.classList.add('in-view')); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        entry.target.classList.add('in-view');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  targets.forEach(t => io.observe(t));
})();

/* ---------- generic accordion ---------- */
document.querySelectorAll('.accordion-trigger').forEach(trigger => {
  trigger.addEventListener('click', () => {
    const item = trigger.closest('.accordion-item');
    const wasOpen = item.classList.contains('open');
    item.parentElement.querySelectorAll('.accordion-item').forEach(i => i.classList.remove('open'));
    if(!wasOpen) item.classList.add('open');
  });
});
