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
   FLIGHTS — filters + mock results
   ========================================================= */
function fmtUSD(n){ return '$' + Math.round(n).toLocaleString('en-US'); }

const flightResults = document.getElementById('flight-results');
if(flightResults){
  const AIRLINES = ["SkyBridge Air","Continental Prime","Meridian Atlantic","Aurora Air","Peregrine Airways","Northline Express"];
  const baseData = AIRLINES.map((name, i) => ({
    name,
    stops: i % 3 === 0 ? 'Nonstop' : (i % 3 === 1 ? '1 stop' : '2 stops'),
    dur: 6 + (i % 4),
    price: 340 + i * 65 + (i % 2 ? 40 : 0),
  }));

  function render(sortBy, maxPrice, stopFilter){
    let rows = baseData.filter(r => r.price <= maxPrice && (stopFilter === 'any' || r.stops === stopFilter));
    if(sortBy === 'price') rows.sort((a,b) => a.price - b.price);
    if(sortBy === 'duration') rows.sort((a,b) => a.dur - b.dur);
    flightResults.innerHTML = rows.length ? rows.map(r => `
      <div class="result-card">
        <div>
          <div class="result-airline">${r.name}</div>
          <div class="result-route">JFK 08:${(10+r.dur)%60 < 10 ? '0'+(10+r.dur)%60 : (10+r.dur)%60} → LHR · ${r.dur}h ${r.dur*7 % 60}m · ${r.stops}</div>
          <div class="result-tags">
            <span class="pill pill-blue">Free cancellation</span>
            <span class="pill pill-green">Wi-Fi onboard</span>
          </div>
        </div>
        <div class="result-price-block">
          <div class="result-price">${fmtUSD(r.price)}</div>
          <div class="muted" style="font-size:12px;">round trip, per traveler</div>
          <button class="btn btn-orange btn-sm mt-12">Select</button>
        </div>
      </div>
    `).join('') : `<p class="muted center" style="padding:40px 0;">No flights match these filters — try widening your price range.</p>`;
    document.getElementById('result-count').textContent = rows.length;
  }

  const priceSlider = document.getElementById('price-range');
  const priceLabel = document.getElementById('price-range-label');
  const sortSelect = document.getElementById('sort-select');
  const stopInputs = document.querySelectorAll('input[name="stops"]');

  function currentStopFilter(){
    const checked = Array.from(stopInputs).find(i => i.checked);
    return checked ? checked.value : 'any';
  }
  function refresh(){
    render(sortSelect ? sortSelect.value : 'price', priceSlider ? Number(priceSlider.value) : 5000, currentStopFilter());
    if(priceLabel) priceLabel.textContent = fmtUSD(priceSlider.value);
  }
  if(priceSlider) priceSlider.addEventListener('input', refresh);
  if(sortSelect) sortSelect.addEventListener('change', refresh);
  stopInputs.forEach(i => i.addEventListener('change', refresh));
  refresh();
}

/* =========================================================
   HOTELS — filters + mock results
   ========================================================= */
const hotelResults = document.getElementById('hotel-results');
if(hotelResults){
  const HOTELS = [
    { name:"The Aldwyn London", stars:5, rating:9.4, reviews:1820, price:420, img:"hotel,london,suite" },
    { name:"Marchetti Suites Rome", stars:4, rating:8.9, reviews:960, price:265, img:"hotel,rome,balcony" },
    { name:"Harbor Point Residences", stars:4, rating:8.6, reviews:1240, price:210, img:"hotel,harbor,view" },
    { name:"Sable & Stone Hotel", stars:5, rating:9.6, reviews:640, price:540, img:"hotel,luxury,pool" },
    { name:"Midtown Central Inn", stars:3, rating:8.1, reviews:2110, price:145, img:"hotel,city,room" },
  ];
  function stars(n){ return '★'.repeat(n) + '☆'.repeat(5-n); }
  function render(maxPrice, minStars){
    const rows = HOTELS.filter(h => h.price <= maxPrice && h.stars >= minStars);
    hotelResults.innerHTML = rows.length ? rows.map(h => `
      <div class="hotel-card">
        <div class="hotel-img photo-img" style="background-image:url('https://loremflickr.com/300/260/${h.img}');"></div>
        <div class="hotel-body">
          <div class="stars">${stars(h.stars)}</div>
          <h3 class="h3 mt-8">${h.name}</h3>
          <div class="muted" style="font-size:13px; margin-top:4px;">City Center · 0.4 mi from downtown</div>
          <div class="result-tags mt-12">
            <span class="pill pill-green">Free cancellation</span>
            <span class="pill pill-blue">Breakfast included</span>
          </div>
        </div>
        <div class="hotel-side">
          <div class="flex items-center gap-8"><span class="pill pill-blue">${h.rating.toFixed(1)}</span><span class="muted" style="font-size:12px;">${h.reviews.toLocaleString()} reviews</span></div>
          <div class="result-price">${fmtUSD(h.price)}</div>
          <div class="muted" style="font-size:12px;">per night</div>
          <button class="btn btn-orange btn-sm">View Rooms</button>
        </div>
      </div>
    `).join('') : `<p class="muted center" style="padding:40px 0;">No hotels match these filters.</p>`;
    document.getElementById('hotel-count').textContent = rows.length;
  }
  const hPrice = document.getElementById('hotel-price-range');
  const hPriceLabel = document.getElementById('hotel-price-label');
  const starInputs = document.querySelectorAll('input[name="stars"]');
  function currentMinStars(){
    const checked = Array.from(starInputs).filter(i => i.checked).map(i => Number(i.value));
    return checked.length ? Math.min(...checked) : 0;
  }
  function refresh(){
    render(hPrice ? Number(hPrice.value) : 2000, currentMinStars());
    if(hPriceLabel) hPriceLabel.textContent = fmtUSD(hPrice.value);
  }
  if(hPrice) hPrice.addEventListener('input', refresh);
  starInputs.forEach(i => i.addEventListener('change', refresh));
  refresh();
}

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

/* ---------- generic accordion ---------- */
document.querySelectorAll('.accordion-trigger').forEach(trigger => {
  trigger.addEventListener('click', () => {
    const item = trigger.closest('.accordion-item');
    const wasOpen = item.classList.contains('open');
    item.parentElement.querySelectorAll('.accordion-item').forEach(i => i.classList.remove('open'));
    if(!wasOpen) item.classList.add('open');
  });
});
