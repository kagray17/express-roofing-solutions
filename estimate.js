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
    buildingFetchRadiusM: 80,
    buildingSelectRadiusM: 30,
    overpassTimeoutMs: 8000,
    residentialSqFt: { min: 600, max: 6000 },
    overpassEndpoints: [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.osm.ch/api/interpreter'
    ],
    disclaimer: 'Ballpark estimate based on satellite measurement; final price confirmed after a free on-site inspection.',
    phoneDisplay: '(765) 490-2914',
    phoneTel: '+17654902914',
    nominatimEmail: 'info@expressroofingsolutions.com',
    nominatimDebounceMs: 400,
    nominatimMinIntervalMs: 1000,
    addressViewbox: '-87.05,40.55,-86.72,40.32',
    defaultCenter: { lat: 40.4191, lng: -86.8919, zoom: 19 }
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
    mode: 'manual',
    buildings: [],
    candidates: [],
    suggestIndex: -1,
    suggestions: []
  };

  let map;
  let imagery;
  let addressMarker;
  let previewLine;
  let polygonLayer;
  let vertexLayer;
  let buildingLayer;
  let buildingHandles;
  let searchTimer;
  let searchAbort;
  let lastNominatimAt = 0;
  let lookupGen = 0;
  let suppressBuildingToggle = false;
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

  function closeRingLngLat(ring) {
    const copy = ring.map((pair) => [pair[1], pair[0]]);
    const first = copy[0];
    const last = copy[copy.length - 1];
    if (!last || first[0] !== last[0] || first[1] !== last[1]) copy.push([first[0], first[1]]);
    return copy;
  }

  function polygonFeature(outer, holes) {
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [closeRingLngLat(outer), ...(holes || []).map(closeRingLngLat)] }
    };
  }

  function areaSqFtFromRings(outer, holes) {
    if (!outer || outer.length < 3) return null;
    if (typeof turf === 'undefined' || typeof turf.area !== 'function') {
      throw new Error('Geodesic area library failed to load.');
    }
    const meters = turf.area(polygonFeature(outer, holes));
    return meters * ESTIMATE_CONFIG.sqFtPerSqMeter;
  }

  function areaSqFtFromLatLngs(latlngs) {
    return areaSqFtFromRings(latlngs, []);
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
    buildingLayer = L.layerGroup().addTo(map);
    buildingHandles = L.layerGroup().addTo(map);
    map.on('click', (event) => {
      if (state.mode === 'auto' && state.step === 1) {
        const hit = buildingAt(event.latlng.lat, event.latlng.lng);
        if (hit && (!state.buildings[0] || hit.id !== state.buildings[0].id)) presentBuilding(hit);
        return;
      }
      if (state.mode !== 'manual' || state.step !== 1 || state.closed || polygonLayer) return;
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
    if (state.mode === 'manual' && !state.closed) {
      if (state.points.length === 0) setStatus(status, 'Tap each corner of the roof. Use Finish outline after at least three points.');
      else if (state.points.length < 3) setStatus(status, `${state.points.length} point${state.points.length === 1 ? '' : 's'} placed. Add ${3 - state.points.length} more.`);
      else setStatus(status, `${state.points.length} points placed. Tap Finish outline to measure the footprint.`);
    }
  }

  function addPoint(latlng) {
    if (state.closed || polygonLayer) return;
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
    clearBuildings();
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

  function openRing(geometry) {
    if (!geometry || geometry.length < 4) return null;
    const ring = geometry.map((point) => [Number(point.lat), Number(point.lon)]).filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
    if (ring.length < 4) return null;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) ring.pop();
    return ring.length >= 3 ? ring : null;
  }

  function buildingKind(tags) {
    const names = {
      house: 'House',
      residential: 'House',
      detached: 'House',
      semidetached_house: 'House',
      terrace: 'House',
      bungalow: 'House',
      yes: 'Building',
      garage: 'Garage',
      garages: 'Garage',
      shed: 'Shed',
      roof: 'Roof',
      apartments: 'Apartments',
      commercial: 'Commercial',
      retail: 'Retail',
      industrial: 'Industrial',
      civic: 'Civic building',
      public: 'Public building',
      church: 'Church',
      school: 'School',
      warehouse: 'Warehouse'
    };
    const key = (tags && tags.building) || 'yes';
    return names[key] || key.replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase());
  }

  function polygonContains(outer, holes, lat, lng) {
    return turf.booleanPointInPolygon(turf.point([lng, lat]), polygonFeature(outer, holes));
  }

  function polygonDistance(outer, holes, lat, lng) {
    const center = turf.centroid(polygonFeature(outer, holes));
    return turf.distance(turf.point([lng, lat]), center, { units: 'meters' });
  }

  function edgeDistance(outer, lat, lng) {
    if (typeof turf.pointToLineDistance !== 'function') return polygonDistance(outer, [], lat, lng);
    const point = turf.point([lng, lat]);
    let min = Infinity;
    for (let i = 0; i < outer.length; i += 1) {
      const start = outer[i];
      const end = outer[(i + 1) % outer.length];
      const line = turf.lineString([[start[1], start[0]], [end[1], end[0]]]);
      const meters = turf.pointToLineDistance(point, line, { units: 'meters' });
      if (meters < min) min = meters;
    }
    return min;
  }

  function polygonsFromElement(element) {
    const tags = element.tags || {};
    if (element.type === 'way') {
      const outer = openRing(element.geometry);
      return outer ? [{ outer, holes: [], tags, id: `way/${element.id}` }] : [];
    }
    if (element.type !== 'relation') return [];
    const outers = [];
    const inners = [];
    (element.members || []).forEach((member) => {
      if (member.type !== 'way') return;
      const ring = openRing(member.geometry);
      if (!ring) return;
      if (member.role === 'inner') inners.push(ring);
      else outers.push(ring);
    });
    return outers.map((outer, index) => ({
      outer,
      holes: outers.length === 1 ? inners : [],
      tags,
      id: `relation/${element.id}/${index}`
    }));
  }

  function parseBuildings(data, lat, lng) {
    const buildings = [];
    (data.elements || []).forEach((element) => {
      polygonsFromElement(element).forEach((polygon) => {
        let sqft;
        try {
          sqft = areaSqFtFromRings(polygon.outer, polygon.holes);
        } catch (err) {
          return;
        }
        if (!(sqft > 40)) return;
        let contains = false;
        let distance = Infinity;
        let edge = Infinity;
        try {
          contains = polygonContains(polygon.outer, polygon.holes, lat, lng);
          edge = contains ? 0 : edgeDistance(polygon.outer, lat, lng);
          distance = edge;
        } catch (err) {
          return;
        }
        if (!contains && edge > ESTIMATE_CONFIG.buildingFetchRadiusM + 8) return;
        buildings.push({
          id: polygon.id,
          label: buildingKind(polygon.tags),
          outer: polygon.outer,
          holes: polygon.holes,
          sqft,
          contains,
          distance,
          selected: false
        });
      });
    });
    return buildings;
  }

  function choosePrimary(buildings) {
    const containing = buildings.filter((building) => building.contains).sort((a, b) => a.sqft - b.sqft);
    if (containing.length) return containing[0];
    const near = buildings.filter((building) => building.distance <= ESTIMATE_CONFIG.buildingSelectRadiusM);
    if (!near.length) return null;
    near.sort((a, b) => a.distance - b.distance);
    return near[0];
  }

  function overpassQuery(lat, lng) {
    const radius = ESTIMATE_CONFIG.buildingFetchRadiusM;
    return `[out:json][timeout:8];(way["building"](around:${radius},${lat},${lng});relation["building"](around:${radius},${lat},${lng}););out geom;`;
  }

  function osmXmlToOverpassElements(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('osm xml');
    const nodes = new Map();
    doc.querySelectorAll('node').forEach((node) => {
      nodes.set(node.getAttribute('id'), {
        lat: Number(node.getAttribute('lat')),
        lon: Number(node.getAttribute('lon'))
      });
    });
    const ways = new Map();
    doc.querySelectorAll('way').forEach((way) => {
      const tags = {};
      way.querySelectorAll('tag').forEach((tag) => { tags[tag.getAttribute('k')] = tag.getAttribute('v'); });
      const geometry = [...way.querySelectorAll('nd')].map((nd) => nodes.get(nd.getAttribute('ref'))).filter(Boolean);
      ways.set(way.getAttribute('id'), { tags, geometry });
    });
    const elements = [];
    ways.forEach((way, id) => {
      if (!way.tags.building || way.geometry.length < 4) return;
      elements.push({ type: 'way', id, tags: way.tags, geometry: way.geometry });
    });
    doc.querySelectorAll('relation').forEach((relation) => {
      const tags = {};
      [...relation.children].forEach((child) => {
        if (child.tagName === 'tag') tags[child.getAttribute('k')] = child.getAttribute('v');
      });
      if (!tags.building) return;
      const members = [...relation.children].filter((child) => child.tagName === 'member').map((member) => {
        const way = ways.get(member.getAttribute('ref'));
        return { type: member.getAttribute('type'), role: member.getAttribute('role'), geometry: way ? way.geometry : null };
      });
      elements.push({ type: 'relation', id: relation.getAttribute('id'), tags, members });
    });
    return { elements };
  }

  async function fetchOsmMap(lat, lng) {
    const radius = ESTIMATE_CONFIG.buildingFetchRadiusM;
    const dLat = radius / 111320;
    const dLng = radius / (111320 * Math.cos(lat * Math.PI / 180));
    const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map((n) => n.toFixed(6)).join(',');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ESTIMATE_CONFIG.overpassTimeoutMs);
    try {
      const res = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`, {
        signal: controller.signal,
        headers: { Accept: 'application/xml' }
      });
      if (!res.ok) throw new Error('osm map');
      return osmXmlToOverpassElements(await res.text());
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  async function fetchOverpass(lat, lng) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ESTIMATE_CONFIG.overpassTimeoutMs);
    const body = overpassQuery(lat, lng);
    try {
      return await Promise.any(ESTIMATE_CONFIG.overpassEndpoints.map(async (endpoint) => {
        const res = await fetch(endpoint, {
          method: 'POST',
          body,
          signal: controller.signal,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8', Accept: 'application/json' }
        });
        if (!res.ok) throw new Error('overpass');
        const data = await res.json();
        if (!data || !Array.isArray(data.elements)) throw new Error('overpass');
        return data;
      }));
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  function leafletRings(building) {
    const outer = building.outer.map((point) => L.latLng(point[0], point[1]));
    if (!building.holes || !building.holes.length) return outer;
    return [outer, ...building.holes.map((hole) => hole.map((point) => L.latLng(point[0], point[1])))];
  }

  function setBuildingLatLngs(building) {
    building.layer.setLatLngs(leafletRings(building));
  }

  function selectedSqFt() {
    return state.buildings.filter((building) => building.selected).reduce((sum, building) => sum + building.sqft, 0);
  }

  function setOutlineMode(mode) {
    state.mode = mode;
    const confirm = $('#confirm-outline');
    const manual = $('#trace-manual');
    const finish = $('#finish-outline');
    const undo = $('#undo-point');
    const list = $('#building-list');
    if (confirm) confirm.hidden = mode !== 'auto';
    if (manual) manual.hidden = mode !== 'auto';
    if (finish) finish.hidden = mode !== 'manual';
    if (undo) undo.hidden = mode !== 'manual';
    if (list) list.hidden = true;
  }

  function clearBuildings() {
    state.buildings = [];
    state.candidates = [];
    if (buildingLayer) buildingLayer.clearLayers();
    if (buildingHandles) buildingHandles.clearLayers();
    const list = $('#building-list');
    if (list) {
      list.innerHTML = '';
      list.hidden = true;
    }
  }

  function updateAutoStatus() {
    const sqft = selectedSqFt();
    const message = `We found your roof — adjust the corners if needed. Footprint: ${sqft > 0 ? sqftText(sqft) : 'select the house'}.`;
    setStatus($('#outline-status'), message);
    const help = $('#outline-help');
    if (help) help.textContent = 'We found your roof — adjust the corners if needed. Tap a different house on the map to switch to it.';
    const title = $('#outline-title');
    if (title) title.textContent = 'Check the roof outline';
    const confirm = $('#confirm-outline');
    if (confirm) confirm.disabled = !(sqft > 0);
    if (state.source === 'auto') state.footprintSqFt = sqft > 0 ? sqft : null;
  }

  function renderBuildingList() {
    const list = $('#building-list');
    if (!list) return;
    list.innerHTML = '';
    list.hidden = true;
  }

  function drawHandles() {
    if (!buildingHandles) return;
    buildingHandles.clearLayers();
    state.buildings.forEach((building) => {
      if (!building.selected) return;
      building.outer.forEach((pair, index) => {
        const icon = L.divIcon({
          className: '',
          html: `<span class="vertex-icon">${index + 1}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });
        const marker = L.marker(pair, { icon, draggable: true, keyboard: true, title: `Corner ${index + 1}` }).addTo(buildingHandles);
        marker.on('dragstart', () => { suppressBuildingToggle = true; });
        marker.on('drag', (event) => {
          const latlng = event.target.getLatLng();
          building.outer[index] = [latlng.lat, latlng.lng];
          setBuildingLatLngs(building);
          try { building.sqft = areaSqFtFromRings(building.outer, building.holes); } catch (err) { /* keep last good area */ }
          updateAutoStatus();
        });
        marker.on('dragend', () => {
          renderBuildingList();
          setTimeout(() => { suppressBuildingToggle = false; }, 350);
        });
      });
    });
  }

  function refreshBuildingStyles() {
    state.buildings.forEach((building) => {
      building.layer.setStyle(building.selected
        ? { color: '#8cd102', weight: 3, fillColor: '#8cd102', fillOpacity: 0.38 }
        : { color: '#ffffff', weight: 2, dashArray: '5 5', fillColor: '#ffffff', fillOpacity: 0.12 });
      if (building.selected) building.layer.bringToFront();
    });
    drawHandles();
    renderBuildingList();
    updateAutoStatus();
  }

  function buildingAt(lat, lng) {
    const hits = (state.candidates || []).filter((building) => {
      try {
        return polygonContains(building.outer, building.holes, lat, lng);
      } catch (err) {
        return false;
      }
    });
    if (!hits.length) return null;
    hits.sort((a, b) => a.sqft - b.sqft);
    return hits[0];
  }

  function presentBuilding(building, candidates) {
    if (polygonLayer && map) {
      map.removeLayer(polygonLayer);
      polygonLayer = null;
    }
    if (buildingLayer) buildingLayer.clearLayers();
    if (buildingHandles) buildingHandles.clearLayers();
    state.points = [];
    state.closed = false;
    if (candidates) state.candidates = candidates;
    const chosen = Object.assign({}, building, { selected: true });
    state.buildings = [chosen];
    const layer = L.polygon(leafletRings(chosen), {
      color: '#8cd102',
      weight: 3,
      fillColor: '#8cd102',
      fillOpacity: 0.38
    }).addTo(buildingLayer);
    chosen.layer = layer;
    layer.on('click', (event) => {
      if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
    });
    setOutlineMode('auto');
    refreshBuildingStyles();
    if (map && layer.getBounds().isValid()) {
      map.invalidateSize();
      map.flyToBounds(layer.getBounds(), { padding: [72, 72], maxZoom: 19, duration: 0.7 });
    }
  }

  function startManualTrace(message) {
    clearBuildings();
    state.points = [];
    state.closed = false;
    state.footprintSqFt = null;
    state.source = null;
    setOutlineMode('manual');
    const title = $('#outline-title');
    const help = $('#outline-help');
    if (title) title.textContent = 'Trace the roof outline';
    if (help) help.textContent = 'Tap each corner of the roof. After three or more points, tap Finish outline. Or enter the home’s square footage.';
    renderVertices();
    setStatus($('#outline-status'), message);
    const next = $('#to-pitch');
    if (next) next.disabled = true;
  }

  function confirmAutoOutline() {
    const sqft = selectedSqFt();
    if (!(sqft > 0)) return null;
    state.footprintSqFt = sqft;
    state.source = 'auto';
    state.livingSqFt = null;
    state.stories = null;
    const next = $('#to-pitch');
    if (next) next.disabled = false;
    setStatus($('#outline-status'), `We found your roof — adjust the corners if needed. Confirmed footprint: ${sqftText(sqft)}.`);
    return sqft;
  }

  async function lookupBuildings(place, gen) {
    setOutlineMode('loading');
    const title = $('#outline-title');
    const help = $('#outline-help');
    if (title) title.textContent = 'Finding the roof';
    if (help) help.textContent = 'Looking up the building outline from OpenStreetMap.';
    setStatus($('#outline-status'), 'Looking up the building outline…');
    const loadFrom = async (source, promise) => {
      const data = await promise;
      const buildings = parseBuildings(data, place.lat, place.lng);
      if (!choosePrimary(buildings)) {
        const error = new Error('no building');
        throw error;
      }
      return { source, buildings };
    };
    let result;
    try {
      result = await Promise.any([
        loadFrom('overpass', fetchOverpass(place.lat, place.lng)),
        loadFrom('osm-map', fetchOsmMap(place.lat, place.lng))
      ]);
    } catch (err) {
      if (gen !== lookupGen) return;
      const errors = err && err.errors ? err.errors : [err];
      const noneFound = errors.some((error) => error && error.message === 'no building');
      startManualTrace(noneFound
        ? 'We couldn’t find a building outline within 30 meters. Trace the roof, or enter the home’s square footage.'
        : 'Building lookup didn’t finish. Trace the roof, or enter the home’s square footage.');
      return;
    }
    if (gen !== lookupGen) return;
    const primary = choosePrimary(result.buildings);
    state.outlineSource = result.source;
    presentBuilding(primary, result.buildings);
  }

  function selectPlace(place, options) {
    const skipLookup = options && options.skipLookup;
    lookupGen += 1;
    const gen = lookupGen;
    state.place = place;
    state.footprintSqFt = null;
    state.source = null;
    state.pitch = null;
    state.points = [];
    state.closed = false;
    state.mode = skipLookup ? 'manual' : 'loading';
    state.outlineSource = null;
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
    clearBuildings();
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
      map.flyTo([place.lat, place.lng], ESTIMATE_CONFIG.defaultCenter.zoom, { duration: 0.75 });
      map.invalidateSize();
    }
    if (skipLookup) {
      setOutlineMode('manual');
      renderVertices();
      return;
    }
    setOutlineMode('loading');
    lookupBuildings(place, gen);
  }

  function tracePolygon(latlngs) {
    lookupGen += 1;
    if (!state.place && latlngs[0]) {
      selectPlace({ label: 'Selected location', lat: latlngs[0][0], lng: latlngs[0][1] }, { skipLookup: true });
    } else {
      showStep(1, true);
      setOutlineMode('manual');
    }
    clearBuildings();
    if (map) map.invalidateSize();
    clearOutline();
    state.mode = 'manual';
    state.points = latlngs.map((pair) => L.latLng(pair[0], pair[1]));
    renderVertices();
    const sqft = closeOutline();
    if (map && polygonLayer) map.fitBounds(polygonLayer.getBounds(), { padding: [24, 24], maxZoom: 19 });
    return { footprintSqFt: sqft };
  }

  function formatStreetAddress(item) {
    const address = item.address || {};
    const street = address.road || address.pedestrian || address.footway || address.residential || '';
    const house = address.house_number || '';
    if (!house || !street) return null;
    const city = address.city || address.town || address.village || address.hamlet || '';
    const iso = address['ISO3166-2-lvl4'] || '';
    const state = iso.startsWith('US-') ? iso.slice(3) : (address.state || '');
    const zip = address.postcode || '';
    const stateZip = [state, zip].filter(Boolean).join(' ');
    if (city && stateZip) return { label: `${house} ${street}, ${city}, ${stateZip}`, city, state };
    return { label: [`${house} ${street}`, city, stateZip].filter(Boolean).join(', '), city, state };
  }

  function localBias(item) {
    const city = (item.city || '').toLowerCase();
    let score = 0;
    if (item.state === 'IN' || item.state === 'Indiana') score += 2;
    if (city === 'lafayette' || city === 'west lafayette') score += 4;
    return score;
  }

  async function searchNominatim(query, signal) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('q', query);
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '5');
    url.searchParams.set('countrycodes', 'us');
    url.searchParams.set('layer', 'address');
    url.searchParams.set('viewbox', ESTIMATE_CONFIG.addressViewbox);
    url.searchParams.set('bounded', '0');
    url.searchParams.set('email', ESTIMATE_CONFIG.nominatimEmail);
    const res = await fetch(url.toString(), {
      signal,
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) throw new Error('nominatim');
    const data = await res.json();
    const seen = new Set();
    const items = [];
    data.forEach((item) => {
      const formatted = formatStreetAddress(item);
      const lat = Number(item.lat);
      const lng = Number(item.lon);
      if (!formatted || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const key = formatted.label.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ label: formatted.label, city: formatted.city, state: formatted.state, lat, lng });
    });
    items.sort((a, b) => localBias(b) - localBias(a));
    return items.slice(0, 5);
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
    highlightSuggestion(0);
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
    const text = query.trim();
    if (text.length < 3) {
      renderSuggestions([]);
      setStatus($('#address-status'), '');
      return;
    }
    searchTimer = setTimeout(() => { runAddressSearch(text); }, ESTIMATE_CONFIG.nominatimDebounceMs);
  }

  async function runAddressSearch(text) {
    const wait = Math.max(0, ESTIMATE_CONFIG.nominatimMinIntervalMs - (Date.now() - lastNominatimAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const input = $('#address-input');
    if (!input || input.value.trim() !== text) return;
    searchAbort = new AbortController();
    lastNominatimAt = Date.now();
    setStatus($('#address-status'), 'Searching addresses…');
    try {
      const items = await searchNominatim(text, searchAbort.signal);
      if ($('#address-input').value.trim() !== text) return;
      renderSuggestions(items);
      setStatus($('#address-status'), items.length ? '' : 'We couldn\'t find that address', !items.length);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if ($('#address-input').value.trim() !== text) return;
      renderSuggestions([]);
      setStatus($('#address-status'), 'Address search is unavailable right now. Try again in a moment.', true);
    }
  }

  function summaryText(estimate) {
    const lines = [
      'Instant Roof Estimate — Express Roofing Solutions',
      `Address: ${state.place ? state.place.label : 'Not provided'}`
    ];
    if (state.source === 'fallback') {
      lines.push(`Measurement: Estimated footprint from ${Number(state.livingSqFt).toLocaleString('en-US')} sq ft living area, ${state.stories} ${Number(state.stories) === 1 ? 'story' : 'stories'}`);
    } else if (state.source === 'auto') {
      lines.push('Measurement: OpenStreetMap building outline, checked on the satellite photo');
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
        const pick = state.suggestIndex >= 0 ? state.suggestions[state.suggestIndex] : state.suggestions[0];
        if (pick) {
          event.preventDefault();
          selectPlace(pick);
        }
      } else if (event.key === 'Escape') {
        $('#address-list').hidden = true;
        input.setAttribute('aria-expanded', 'false');
      }
    });

    $('#undo-point').addEventListener('click', undoPoint);
    $('#finish-outline').addEventListener('click', closeOutline);
    $('#clear-outline').addEventListener('click', () => {
      lookupGen += 1;
      startManualTrace('Outline cleared. Tap each corner of the roof, or enter the home’s square footage.');
    });
    $('#confirm-outline').addEventListener('click', confirmAutoOutline);
    $('#trace-manual').addEventListener('click', () => {
      lookupGen += 1;
      startManualTrace('Trace the roof corners, or enter the home’s square footage.');
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
      points: state.points.length,
      mode: state.mode,
      outlineSource: state.outlineSource,
      buildings: state.buildings.map((building) => ({
        id: building.id,
        label: building.label,
        sqft: building.sqft,
        selected: building.selected,
        contains: building.contains
      })),
      candidates: (state.candidates || []).map((building) => ({
        id: building.id,
        sqft: Math.round(building.sqft),
        distance: Math.round(building.distance),
        lat: building.outer.reduce((sum, point) => sum + point[0], 0) / building.outer.length,
        lng: building.outer.reduce((sum, point) => sum + point[1], 0) / building.outer.length
      }))
    })
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
