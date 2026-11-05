/* Express Roofing Solutions — Instant Roof Estimate
   Change prices, pitch multipliers, and waste in ESTIMATE_CONFIG. */
(() => {
  const ESTIMATE_CONFIG = {
    wasteFactor: 1.10,
    squareSqFt: 100,
    roundToDollars: 100,
    sqFtPerSqMeter: 10.763910416709722,
    pitchMultipliers: {
      low: 1.05,
      average: 1.15,
      steep: 1.30
    },
    pitches: [
      { id: 'low', label: 'Low / flat-ish', hint: 'Shallow slope, easy to walk' },
      { id: 'average', label: 'Average (walkable)', hint: 'Typical residential pitch' },
      { id: 'steep', label: 'Steep', hint: 'Harder to walk, more roof surface' }
    ],
    materialLabel: 'GAF architectural asphalt shingles',
    pricePerSquare: { low: 425, high: 500 },
    disclaimer: 'Ballpark estimate based on satellite measurement; final price confirmed after a free on-site inspection.',
    phoneDisplay: '(765) 490-2914',
    phoneTel: '+17654902914',
    nominatimEmail: 'info@expressroofingsolutions.com',
    defaultCenter: { lat: 40.4191, lng: -86.8919, zoom: 12 }
  };

  const STEPS = ['address', 'outline', 'pitch', 'result'];
  const STEP_LABELS = ['Address', 'Roof', 'Pitch', 'Result'];

  const state = {
    step: 0,
    place: null,
    points: [],
    closed: false,
    footprintSqFt: null,
    source: null,
    livingSqFt: null,
    stories: null,
    pitch: null,
    suggestIndex: -1,
    suggestions: []
  };

  let map;
  let imagery;
  let addressMarker;
  let previewLine;
  let polygonLayer;
  let vertexLayer;
  let searchTimer;
  let searchAbort;
  let lastSummary = '';

  const $ = (sel) => document.querySelector(sel);
  const money = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const sqftText = (n) => `${Math.round(n).toLocaleString('en-US')} sq ft`;

  function roundTo(n, step) {
    return Math.round(n / step) * step;
  }

  function footprintFromLivingArea(livingSqFt, stories) {
    const living = Number(livingSqFt);
    const levels = Number(stories);
    if (!(living > 0) || !(levels > 0)) return null;
    return living / levels;
  }

  function toPolygonFeature(latlngs) {
    const ring = latlngs.map((pair) => [pair[1], pair[0]]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!last || first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
  }

  function areaSqFtFromLatLngs(latlngs) {
    if (!latlngs || latlngs.length < 3) return null;
    if (typeof turf === 'undefined' || typeof turf.area !== 'function') {
      throw new Error('Geodesic area library failed to load.');
    }
    const meters = turf.area(toPolygonFeature(latlngs));
    return meters * ESTIMATE_CONFIG.sqFtPerSqMeter;
  }

  function computeEstimate({ footprintSqFt, pitch }) {
    const pitchMult = ESTIMATE_CONFIG.pitchMultipliers[pitch];
    if (!(pitchMult > 0) || !(footprintSqFt > 0)) return null;
    const adjustedSqFt = footprintSqFt * pitchMult * ESTIMATE_CONFIG.wasteFactor;
    const squares = adjustedSqFt / ESTIMATE_CONFIG.squareSqFt;
    let low = roundTo(squares * ESTIMATE_CONFIG.pricePerSquare.low, ESTIMATE_CONFIG.roundToDollars);
    let high = roundTo(squares * ESTIMATE_CONFIG.pricePerSquare.high, ESTIMATE_CONFIG.roundToDollars);
    if (high < low) high = low;
    return {
      low,
      high,
      squares,
      adjustedSqFt,
      footprintSqFt,
      pitch,
      pitchMult,
      materialLabel: ESTIMATE_CONFIG.materialLabel
    };
  }

  function pitchLabel(id) {
    const found = ESTIMATE_CONFIG.pitches.find((p) => p.id === id);
    return found ? found.label : id;
  }

  function setStatus(el, message, isError) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('is-error', Boolean(isError));
  }

  function showStep(index) {
    state.step = index;
    document.querySelectorAll('[data-step-panel]').forEach((panel) => {
      panel.hidden = Number(panel.getAttribute('data-step-panel')) !== index;
    });
    document.querySelectorAll('[data-step-jump]').forEach((btn) => {
      const n = Number(btn.getAttribute('data-step-jump'));
      const allowed = n === 0 || (n === 1 && state.place) || (n === 2 && state.footprintSqFt) || (n === 3 && state.pitch);
      btn.disabled = n > index && !allowed;
      if (n === index) btn.setAttribute('aria-current', 'step');
      else btn.removeAttribute('aria-current');
    });
    if (index === 1) {
      ensureMap();
      if (map) {
        map.invalidateSize();
        requestAnimationFrame(() => map.invalidateSize());
      }
    }
    const heading = document.querySelector(`[data-step-panel="${index}"] h2`);
    if (arguments[1] && heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
  }

  function ensureMap() {
    if (map || typeof L === 'undefined') return map;
    const node = $('#est-map');
    if (!node) return null;
    map = L.map(node, {
      zoomControl: true,
      attributionControl: true
    }).setView(
      [ESTIMATE_CONFIG.defaultCenter.lat, ESTIMATE_CONFIG.defaultCenter.lng],
      ESTIMATE_CONFIG.defaultCenter.zoom
    );
    imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      maxZoom: 19,
      maxNativeZoom: 19
    }).addTo(map);
    vertexLayer = L.layerGroup().addTo(map);
    map.doubleClickZoom.disable();
    map.on('click', (event) => {
      if (state.step !== 1 || state.closed) return;
      addPoint(event.latlng);
    });
    return map;
  }

  function renderVertices() {
    if (!vertexLayer) return;
    vertexLayer.clearLayers();
    state.points.forEach((latlng, i) => {
      const icon = L.divIcon({
        className: '',
        html: `<span class="vertex-icon">${i + 1}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
      L.marker(latlng, { icon, keyboard: false, interactive: false }).addTo(vertexLayer);
    });
    if (previewLine) {
      map.removeLayer(previewLine);
      previewLine = null;
    }
    if (!state.closed && state.points.length >= 2) {
      previewLine = L.polyline(state.points, { color: '#8cd102', weight: 3, dashArray: '6 6' }).addTo(map);
    }
    const finish = $('#finish-outline');
    const undo = $('#undo-point');
    if (finish) finish.disabled = state.closed || state.points.length < 3;
    if (undo) undo.disabled = state.closed || state.points.length === 0;
    const status = $('#outline-status');
    if (!state.closed) {
      if (state.points.length === 0) setStatus(status, 'Tap each corner of the roof. Use Finish outline after at least three points.');
      else if (state.points.length < 3) setStatus(status, `${state.points.length} point${state.points.length === 1 ? '' : 's'} placed. Add ${3 - state.points.length} more.`);
      else setStatus(status, `${state.points.length} points placed. Tap Finish outline to measure the footprint.`);
    }
  }

  function addPoint(latlng) {
    state.closed = false;
    state.source = state.source === 'fallback' ? null : state.source;
    if (state.source !== 'traced') {
      state.footprintSqFt = null;
    }
    state.points.push(latlng);
    if (polygonLayer) {
      map.removeLayer(polygonLayer);
      polygonLayer = null;
    }
    renderVertices();
    const next = $('#to-pitch');
    if (next && state.source !== 'fallback') next.disabled = true;
  }

  function undoPoint() {
    if (state.closed || !state.points.length) return;
    state.points.pop();
    renderVertices();
  }

  function clearOutline() {
    state.points = [];
    state.closed = false;
    if (state.source === 'traced') {
      state.footprintSqFt = null;
      state.source = null;
    }
    if (polygonLayer && map) map.removeLayer(polygonLayer);
    polygonLayer = null;
    if (previewLine && map) map.removeLayer(previewLine);
    previewLine = null;
    if (vertexLayer) vertexLayer.clearLayers();
    renderVertices();
    const next = $('#to-pitch');
    if (next) next.disabled = !state.footprintSqFt;
  }

  function closeOutline() {
    if (state.points.length < 3) return null;
    const latlngs = state.points.map((p) => [p.lat, p.lng]);
    let sqft;
    try {
      sqft = areaSqFtFromLatLngs(latlngs);
    } catch (err) {
      setStatus($('#outline-status'), err.message || 'Could not measure that outline.', true);
      return null;
    }
    if (polygonLayer) map.removeLayer(polygonLayer);
    if (previewLine) {
      map.removeLayer(previewLine);
      previewLine = null;
    }
    polygonLayer = L.polygon(state.points, {
      color: '#8cd102',
      weight: 3,
      fillColor: '#8cd102',
      fillOpacity: 0.35
    }).addTo(map);
    state.closed = true;
    state.footprintSqFt = sqft;
    state.source = 'traced';
    state.livingSqFt = null;
    state.stories = null;
    setStatus($('#outline-status'), `Traced footprint: ${sqftText(sqft)}.`);
    const next = $('#to-pitch');
    if (next) next.disabled = false;
    const finish = $('#finish-outline');
    if (finish) finish.disabled = true;
    const undo = $('#undo-point');
    if (undo) undo.disabled = true;
    return sqft;
  }

  function applyFallback(livingSqFt, stories) {
    const sqft = footprintFromLivingArea(livingSqFt, stories);
    if (!sqft) {
      setStatus($('#outline-status'), 'Enter the home square footage and number of stories.', true);
      return null;
    }
    state.footprintSqFt = sqft;
    state.source = 'fallback';
    state.livingSqFt = Number(livingSqFt);
    state.stories = Number(stories);
    setStatus($('#outline-status'), `Estimated footprint: ${sqftText(sqft)} (${Number(livingSqFt).toLocaleString('en-US')} sq ft ÷ ${stories} ${Number(stories) === 1 ? 'story' : 'stories'}).`);
    const next = $('#to-pitch');
    if (next) next.disabled = false;
    return sqft;
  }

  function selectPlace(place) {
    state.place = place;
    state.footprintSqFt = null;
    state.source = null;
    state.pitch = null;
    state.points = [];
    state.closed = false;
    const next = $('#to-pitch');
    if (next) next.disabled = true;
    const input = $('#address-input');
    if (input) input.value = place.label;
    const list = $('#address-list');
    if (list) {
      list.hidden = true;
      list.innerHTML = '';
    }
    if (input) input.setAttribute('aria-expanded', 'false');
    setStatus($('#address-status'), place.label);
    showStep(1, true);
    if (polygonLayer && map) map.removeLayer(polygonLayer);
    polygonLayer = null;
    if (previewLine && map) map.removeLayer(previewLine);
    previewLine = null;
    if (vertexLayer) vertexLayer.clearLayers();
    if (map) {
      if (addressMarker) map.removeLayer(addressMarker);
      addressMarker = L.circleMarker([place.lat, place.lng], {
        radius: 7,
        color: '#0f2334',
        weight: 2,
        fillColor: '#8cd102',
        fillOpacity: 1
      }).addTo(map);
      map.setView([place.lat, place.lng], 19);
      map.invalidateSize();
    }
    renderVertices();
  }

  function tracePolygon(latlngs) {
    if (!state.place && latlngs[0]) {
      selectPlace({ label: 'Selected location', lat: latlngs[0][0], lng: latlngs[0][1] });
    } else {
      showStep(1, true);
    }
    if (map) map.invalidateSize();
    clearOutline();
    state.points = latlngs.map((pair) => L.latLng(pair[0], pair[1]));
    renderVertices();
    const sqft = closeOutline();
    if (map && polygonLayer) map.fitBounds(polygonLayer.getBounds(), { padding: [24, 24], maxZoom: 19 });
    return { footprintSqFt: sqft };
  }

  async function searchNominatim(query, signal) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('q', query);
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '5');
    url.searchParams.set('countrycodes', 'us');
    url.searchParams.set('email', ESTIMATE_CONFIG.nominatimEmail);
    const res = await fetch(url.toString(), {
      signal,
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) throw new Error('nominatim');
    const data = await res.json();
    return data.map((item) => ({
      label: item.display_name,
      lat: Number(item.lat),
      lng: Number(item.lon)
    })).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
  }

  async function searchPhoton(query, signal) {
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '5');
    url.searchParams.set('lat', String(ESTIMATE_CONFIG.defaultCenter.lat));
    url.searchParams.set('lon', String(ESTIMATE_CONFIG.defaultCenter.lng));
    const res = await fetch(url.toString(), { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('photon');
    const data = await res.json();
    return (data.features || []).map((feature) => {
      const p = feature.properties || {};
      if (p.countrycode && p.countrycode !== 'US') return null;
      const line = [p.housenumber, p.street].filter(Boolean).join(' ');
      const city = [p.city || p.name, p.state, p.postcode].filter(Boolean).join(', ');
      const label = [line, city].filter(Boolean).join(', ') || p.name;
      const coords = feature.geometry && feature.geometry.coordinates;
      if (!coords) return null;
      return { label, lat: Number(coords[1]), lng: Number(coords[0]) };
    }).filter(Boolean);
  }

  function renderSuggestions(items) {
    const list = $('#address-list');
    const input = $('#address-input');
    state.suggestions = items;
    state.suggestIndex = -1;
    if (!list) return;
    list.innerHTML = '';
    if (!items.length) {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'presentation');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'option');
      btn.id = `address-opt-${i}`;
      btn.textContent = item.label;
      btn.addEventListener('click', () => selectPlace(item));
      li.appendChild(btn);
      list.appendChild(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function highlightSuggestion(index) {
    const buttons = [...document.querySelectorAll('#address-list [role="option"]')];
    if (!buttons.length) return;
    const next = Math.max(0, Math.min(buttons.length - 1, index));
    state.suggestIndex = next;
    buttons.forEach((btn, i) => btn.setAttribute('aria-selected', String(i === next)));
    buttons[next].scrollIntoView({ block: 'nearest' });
    $('#address-input').setAttribute('aria-activedescendant', buttons[next].id);
  }

  function queueSearch(query) {
    clearTimeout(searchTimer);
    if (searchAbort) searchAbort.abort();
    if (query.trim().length < 3) {
      renderSuggestions([]);
      setStatus($('#address-status'), 'Type at least 3 characters.');
      return;
    }
    searchTimer = setTimeout(async () => {
      searchAbort = new AbortController();
      setStatus($('#address-status'), 'Searching addresses…');
      try {
        let items = [];
        try {
          items = await searchNominatim(query.trim(), searchAbort.signal);
        } catch (err) {
          if (err.name === 'AbortError') return;
          items = await searchPhoton(query.trim(), searchAbort.signal);
        }
        if (!items.length) {
          try { items = await searchPhoton(query.trim(), searchAbort.signal); } catch (err) { if (err.name === 'AbortError') return; }
        }
        renderSuggestions(items);
        setStatus($('#address-status'), items.length ? `${items.length} match${items.length === 1 ? '' : 'es'}.` : 'No matches. Try a full street address.');
      } catch (err) {
        if (err.name === 'AbortError') return;
        renderSuggestions([]);
        setStatus($('#address-status'), 'Address search is unavailable right now. Try again in a moment.', true);
      }
    }, 650);
  }

  function summaryText(estimate) {
    const lines = [
      'Instant Roof Estimate — Express Roofing Solutions',
      `Address: ${state.place ? state.place.label : 'Not provided'}`
    ];
    if (state.source === 'fallback') {
      lines.push(`Measurement: Estimated footprint from ${Number(state.livingSqFt).toLocaleString('en-US')} sq ft living area, ${state.stories} ${Number(state.stories) === 1 ? 'story' : 'stories'}`);
    } else {
      lines.push('Measurement: Traced roof outline on satellite imagery');
    }
    lines.push(`Footprint: ${sqftText(estimate.footprintSqFt)}`);
    lines.push(`Pitch: ${pitchLabel(estimate.pitch)} × ${estimate.pitchMult.toFixed(2)}`);
    lines.push(`Waste: ${Math.round((ESTIMATE_CONFIG.wasteFactor - 1) * 100)}%`);
    lines.push(`Roof area: ${sqftText(estimate.adjustedSqFt)} (${estimate.squares.toFixed(1)} squares)`);
    lines.push(`Material: ${estimate.materialLabel}`);
    lines.push(`Installed estimate: ${money(estimate.low)} – ${money(estimate.high)}`);
    lines.push(ESTIMATE_CONFIG.disclaimer);
    lines.push(`Call ${ESTIMATE_CONFIG.phoneDisplay}`);
    return lines.join('\n');
  }

  function renderResult() {
    const estimate = computeEstimate({
      footprintSqFt: state.footprintSqFt,
      pitch: state.pitch
    });
    if (!estimate) return;
    const price = $('#est-price');
    const detail = $('#est-detail');
    const summary = $('#est-summary');
    const disclaimer = $('#est-disclaimer');
    lastSummary = summaryText(estimate);
    disclaimer.textContent = ESTIMATE_CONFIG.disclaimer;
    price.textContent = `${money(estimate.low)} – ${money(estimate.high)}`;
    price.dataset.low = String(estimate.low);
    price.dataset.high = String(estimate.high);
    price.dataset.sqft = String(estimate.footprintSqFt);
    price.dataset.squares = String(estimate.squares);
    detail.textContent = `${estimate.squares.toFixed(1)} squares · ${sqftText(estimate.adjustedSqFt)} including pitch and waste · ${estimate.materialLabel}`;
    summary.textContent = lastSummary;
    showStep(3, true);
  }

  function buildChoices() {
    const pitchMount = $('#pitch-mount');
    const pitchSet = document.createElement('fieldset');
    pitchSet.className = 'est-choices';
    pitchSet.innerHTML = '<legend class="sr-only">How steep is the roof?</legend>';
    ESTIMATE_CONFIG.pitches.forEach((pitch) => {
      const label = document.createElement('label');
      label.className = 'choice';
      const mult = ESTIMATE_CONFIG.pitchMultipliers[pitch.id];
      label.innerHTML = `<input type="radio" name="pitch" value="${pitch.id}"><span><strong>${pitch.label}</strong><small>${pitch.hint} · ×${mult.toFixed(2)} plus ${Math.round((ESTIMATE_CONFIG.wasteFactor - 1) * 100)}% waste</small></span>`;
      pitchSet.appendChild(label);
    });
    pitchMount.appendChild(pitchSet);
    pitchSet.addEventListener('change', (event) => {
      if (event.target.name !== 'pitch') return;
      state.pitch = event.target.value;
      const next = $('#to-result');
      if (next) next.disabled = false;
    });
  }

  function buildProgress() {
    const list = $('#est-progress');
    STEP_LABELS.forEach((label, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.stepJump = String(i);
      btn.textContent = `${i + 1}. ${label}`;
      btn.addEventListener('click', () => {
        if (i <= state.step) showStep(i, true);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  async function copySummary() {
    const status = $('#copy-status');
    try {
      await navigator.clipboard.writeText(lastSummary);
      setStatus(status, 'Estimate copied.');
    } catch (err) {
      const area = document.createElement('textarea');
      area.value = lastSummary;
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      setStatus(status, ok ? 'Estimate copied.' : 'Select the summary and copy it manually.', !ok);
    }
  }

  function boot() {
    if (!$('#est-map')) return;
    buildProgress();
    buildChoices();
    showStep(0);

    const input = $('#address-input');
    input.addEventListener('input', () => queueSearch(input.value));
    input.addEventListener('keydown', (event) => {
      const open = !$('#address-list').hidden;
      if (event.key === 'ArrowDown' && open) {
        event.preventDefault();
        highlightSuggestion(state.suggestIndex + 1);
      } else if (event.key === 'ArrowUp' && open) {
        event.preventDefault();
        highlightSuggestion(state.suggestIndex - 1);
      } else if (event.key === 'Enter') {
        if (open && state.suggestIndex >= 0) {
          event.preventDefault();
          selectPlace(state.suggestions[state.suggestIndex]);
        }
      } else if (event.key === 'Escape') {
        $('#address-list').hidden = true;
        input.setAttribute('aria-expanded', 'false');
      }
    });

    $('#undo-point').addEventListener('click', undoPoint);
    $('#finish-outline').addEventListener('click', closeOutline);
    $('#clear-outline').addEventListener('click', () => {
      clearOutline();
      state.footprintSqFt = null;
      state.source = null;
      $('#to-pitch').disabled = true;
      setStatus($('#outline-status'), 'Outline cleared.');
    });
    $('#cant-trace').addEventListener('click', () => {
      const form = $('#fallback-form');
      form.hidden = !form.hidden;
      if (!form.hidden) $('#living-sqft').focus();
    });
    $('#fallback-form').addEventListener('submit', (event) => {
      event.preventDefault();
      applyFallback($('#living-sqft').value, $('#stories').value);
    });
    $('#to-pitch').addEventListener('click', () => {
      if (state.footprintSqFt) showStep(2, true);
    });
    $('#back-outline').addEventListener('click', () => showStep(1, true));
    $('#to-result').addEventListener('click', () => {
      if (state.pitch) renderResult();
    });
    $('#back-pitch').addEventListener('click', () => showStep(2, true));
    $('#copy-estimate').addEventListener('click', copySummary);
    $('#change-address').addEventListener('click', () => showStep(0, true));
  }

  function frameRing(latlngs) {
    showStep(1);
    if (!map) return;
    map.invalidateSize();
    map.fitBounds(L.latLngBounds(latlngs.map((pair) => [pair[0], pair[1]])), { padding: [48, 48], maxZoom: 19 });
  }

  function containerPoint(lat, lng) {
    if (!map) return null;
    const p = map.latLngToContainerPoint([lat, lng]);
    const rect = map.getContainer().getBoundingClientRect();
    return {
      x: rect.left + p.x,
      y: rect.top + p.y,
      inside: p.x >= 0 && p.y >= 0 && p.x <= rect.width && p.y <= rect.height
    };
  }

  window.ERSEstimate = {
    config: ESTIMATE_CONFIG,
    computeEstimate,
    footprintFromLivingArea,
    areaSqFtFromLatLngs,
    tracePolygon,
    applyFallback,
    selectPlace,
    renderResult,
    frameRing,
    containerPoint,
    getState: () => ({
      footprintSqFt: state.footprintSqFt,
      source: state.source,
      pitch: state.pitch,
      place: state.place,
      step: state.step,
      points: state.points.length
    })
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
