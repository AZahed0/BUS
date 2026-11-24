const DATA_URL = "./lijnen_en_haltes_den_helder.geojson";
const ADDRESS_SEARCH_URL = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";
const ROUTE_PALETTE = ["#1677d2", "#00a99d", "#8854d0", "#f59e0b", "#22a06b", "#e05252", "#24476b"];
const TILE_LAYERS = {
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }
  },
  topo: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    options: { maxZoom: 19, attribution: "Tiles &copy; Esri" }
  },
  aerial: {
    url: "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg",
    options: { maxZoom: 19, attribution: '&copy; <a href="https://www.pdok.nl/">PDOK</a> / Beeldmateriaal Nederland' }
  }
};
const DEN_HELDER_VIEW = { center: [52.9566, 4.7613], zoom: 13 };

const $ = (id) => document.getElementById(id);
let map;
let stopsLayer;
let routesLayer;
let routeFeatures = [];
let stopFeatures = [];
let routeColors = new Map();
let selectedRefs = new Set();
let routeCheckboxes = [];
let locationMarker;
let addressMarker;
let searchTimer;
let activeAddressSearch;
let showStops = true;
let showRoutes = true;
let showRouteLabels = true;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function getBusNumbers(properties = {}) {
  const found = [];
  const add = (value) => {
    if (Array.isArray(value)) value.forEach(add);
    else if (value !== null && value !== undefined && String(value).trim()) {
      String(value).split(/[;,]/).map((part) => part.trim()).filter(Boolean).forEach((part) => found.push(part));
    }
  };
  add(properties.busnummers_lijst);
  add(properties.busnummers_str);
  if (Array.isArray(properties["@relations"])) {
    properties["@relations"].forEach((relation) => add(relation?.reltags?.ref));
  }
  return [...new Set(found)];
}

function getRouteRef(feature) {
  const properties = feature.properties || {};
  const ref = properties.ref ?? getBusNumbers(properties)[0];
  return ref === undefined || ref === null || String(ref).trim() === "" ? "" : String(ref).trim();
}

function showError(message) {
  const banner = $("errorContainer");
  banner.textContent = message;
  banner.classList.remove("hidden");
}

function setLoading(loading) {
  $("loadingIndicator").classList.toggle("hidden", !loading);
}

function initMap() {
  map = L.map("viewDiv", { zoomControl: false, preferCanvas: true, zoomSnap: 0.25 })
    .setView(DEN_HELDER_VIEW.center, DEN_HELDER_VIEW.zoom);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  setBasemap("topo");
  loadData();
  setupEvents();
}

let activeTiles;
function setBasemap(name) {
  const definition = TILE_LAYERS[name] || TILE_LAYERS.osm;
  if (activeTiles) map.removeLayer(activeTiles);
  activeTiles = L.tileLayer(definition.url, definition.options).addTo(map);
  activeTiles.on("tileerror", () => showError("De gekozen basiskaart kan niet volledig worden geladen. Probeer een andere basiskaart."));
}

async function loadData() {
  setLoading(true);
  $("errorContainer").classList.add("hidden");
  try {
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Lokaal GeoJSON-bestand niet gevonden (HTTP ${response.status}).`);
    const data = await response.json();
    if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
      throw new Error("Het lokale bestand is geen geldige GeoJSON FeatureCollection.");
    }
    const supported = data.features.filter((feature) => {
      const type = feature.geometry?.type;
      return ["Point", "MultiPoint", "LineString", "MultiLineString"].includes(type);
    });
    stopFeatures = supported.filter((feature) => ["Point", "MultiPoint"].includes(feature.geometry.type));
    routeFeatures = supported.filter((feature) => ["LineString", "MultiLineString"].includes(feature.geometry.type));

    routeColors = createRouteColors(routeFeatures);
    buildRouteOptions();
    buildLegend();
    drawData();
    $("statTotalStops").textContent = stopFeatures.length;
    $("statTotalRoutes").textContent = routeFeatures.length;
    updateStats();
    focusDenHelder();
  } catch (error) {
    console.error(error);
    showError(`Gegevens laden mislukt: ${error.message} Controleer dat index.html en ${DATA_URL.slice(2)} in dezelfde map staan en start de app via een lokale webserver.`);
  } finally {
    setLoading(false);
  }
}

function createRouteColors(features) {
  const refs = [...new Set(features.map(getRouteRef).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "nl", { numeric: true }));
  const colors = new Map();
  refs.forEach((ref, index) => colors.set(ref, ROUTE_PALETTE[index % ROUTE_PALETTE.length]));
  return colors;
}

function buildRouteOptions() {
  const container = $("routeChoices");
  container.replaceChildren();
  const refs = [...routeColors.keys()];
  routeCheckboxes = refs.map((ref) => {
    const label = document.createElement("label");
    label.className = "route-choice";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = ref;
    checkbox.checked = selectedRefs.has(ref);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedRefs.add(ref);
      else selectedRefs.delete(ref);
      drawData();
      updateStats();
    });
    const swatch = document.createElement("i");
    swatch.className = "route-swatch";
    swatch.style.backgroundColor = routeColors.get(ref);
    const title = document.createElement("span");
    title.textContent = `Lijn ${ref}`;
    label.append(checkbox, swatch, title);
    container.append(label);
    return checkbox;
  });
}

function drawData() {
  if (routesLayer) map.removeLayer(routesLayer);
  if (stopsLayer) map.removeLayer(stopsLayer);

  const visibleRoutes = routeFeatures.filter((feature) => {
    const ref = getRouteRef(feature);
    return selectedRefs.size === 0 || selectedRefs.has(ref);
  });
  const placeQuery = $("filterPlace").value.trim().toLocaleLowerCase("nl");
  const visibleStops = stopFeatures.filter((feature) => {
    const properties = feature.properties || {};
    const nameMatches = !placeQuery || String(properties.name || "").toLocaleLowerCase("nl").includes(placeQuery);
    const refMatches = selectedRefs.size === 0 || getBusNumbers(properties).some((ref) => selectedRefs.has(ref));
    return nameMatches && refMatches;
  });

  routesLayer = L.geoJSON({ type: "FeatureCollection", features: visibleRoutes }, {
    style: (feature) => ({
      color: routeColors.get(getRouteRef(feature)) || ROUTE_PALETTE[0],
      weight: 5,
      opacity: 0.88,
      lineCap: "round",
      lineJoin: "round"
    }),
    onEachFeature: (feature, layer) => {
      const ref = getRouteRef(feature);
      bindRouteTooltip(layer, ref);
      layer.on("click", () => {
        if (ref) {
          selectedRefs.clear();
          selectedRefs.add(ref);
          routeCheckboxes.forEach((checkbox) => { checkbox.checked = checkbox.value === ref; });
          drawData();
          updateStats();
        }
      });
    }
  }).addTo(map);
  if (!showRoutes) map.removeLayer(routesLayer);

  stopsLayer = L.geoJSON({ type: "FeatureCollection", features: visibleStops }, {
    pointToLayer: (_feature, latlng) => L.marker(latlng, {
      icon: L.divIcon({
        className: "stop-icon-marker",
        html: '<svg viewBox="0 0 32 38" width="28" height="34" aria-hidden="true"><path d="M16 1C8.5 1 2.5 7 2.5 14.5c0 9 13.5 22 13.5 22s13.5-13 13.5-22C29.5 7 23.5 1 16 1Z" fill="#014b6b" stroke="#fff" stroke-width="2"/><rect x="10" y="8" width="12" height="15" rx="3" fill="#fff"/><rect x="12" y="10" width="8" height="5" rx="1" fill="#014b6b"/><rect x="12" y="17" width="8" height="3" rx="1" fill="#00a99d"/><circle cx="13" cy="23" r="1.7" fill="#014b6b"/><circle cx="19" cy="23" r="1.7" fill="#014b6b"/></svg>',
        iconSize: [28, 34],
        iconAnchor: [14, 33],
        popupAnchor: [0, -31]
      }),
      title: _feature.properties?.name || "Bushalte"
    }),
    onEachFeature: (feature, layer) => {
      const properties = feature.properties || {};
      const stopName = String(properties.name || "Onbekende halte").trim();
      const busNumbers = getBusNumbers(properties);
      layer.on("mouseover", () => layer.getElement()?.classList.add("is-hovered"));
      layer.on("mouseout", () => layer.getElement()?.classList.remove("is-hovered"));
      layer.bindTooltip(escapeHtml(stopName), {
        direction: "top",
        offset: [0, -8],
        opacity: 0.96,
        className: "stop-tooltip"
      });
      const popup = document.createElement("div");
      popup.className = "stop-popup";
      const heading = document.createElement("strong");
      heading.textContent = stopName;
      const line = document.createElement("div");
      line.className = "popup-bus-number";
      line.textContent = busNumbers.length ? `Bus ${busNumbers.join(", ")}` : "Busnummer niet beschikbaar";
      popup.append(heading, line);
      layer.bindPopup(popup, { maxWidth: 250, closeButton: true });
    }
  }).addTo(map);
  if (!showStops) map.removeLayer(stopsLayer);
}

function buildLegend() {
  const legend = $("legend");
  legend.replaceChildren();
  routeColors.forEach((color, ref) => {
    const row = document.createElement("div");
    row.className = "legend-row";
    const line = document.createElement("i");
    line.className = "legend-line";
    line.style.backgroundColor = color;
    const label = document.createElement("span");
    label.textContent = `Lijn ${ref}`;
    row.append(line, label);
    legend.append(row);
  });
  const stop = document.createElement("div");
  stop.className = "legend-row";
  const stopSymbol = document.createElement("i");
  stopSymbol.className = "legend-stop-dot";
  const stopLabel = document.createElement("span");
  stopLabel.textContent = "Bushalte";
  stop.append(stopSymbol, stopLabel);
  legend.append(stop);
}

function updateStats() {
  const bounds = map.getBounds();
  let stopsOnScreen = 0;
  let linesOnScreen = 0;
  if (showStops) stopsLayer?.eachLayer((layer) => {
    if (bounds.contains(layer.getLatLng())) stopsOnScreen++;
  });
  if (showRoutes) routesLayer?.eachLayer((layer) => {
    if (layer.getBounds().intersects(bounds)) linesOnScreen++;
  });
  $("statVisible").textContent = stopsOnScreen + linesOnScreen;
  $("statSelected").textContent = selectedRefs.size;
}

function updateRouteLabels() {
  if (!routesLayer) return;
  routesLayer.eachLayer((layer) => {
    const ref = getRouteRef(layer.feature);
    bindRouteTooltip(layer, ref);
  });
}

function bindRouteTooltip(layer, ref) {
  layer.unbindTooltip();
  if (!showRouteLabels) return;
  layer.bindTooltip(`Lijn ${escapeHtml(ref)}`, {
    sticky: true,
    permanent: map.getZoom() >= 11,
    direction: "center",
    className: "route-tooltip"
  });
}

function zoomToVisibleData() {
  focusDenHelder();
}

function focusDenHelder() {
  map.setView(DEN_HELDER_VIEW.center, DEN_HELDER_VIEW.zoom);
}

function setupEvents() {
  $("toggleStops").addEventListener("change", (event) => {
    showStops = event.target.checked;
    if (event.target.checked) map.addLayer(stopsLayer);
    else map.removeLayer(stopsLayer);
    updateStats();
  });
  $("toggleRoutes").addEventListener("change", (event) => {
    showRoutes = event.target.checked;
    drawData();
    updateStats();
  });
  $("toggleLabels").addEventListener("change", (event) => {
    showRouteLabels = event.target.checked;
    updateRouteLabels();
  });
  $("basemapSelect").addEventListener("change", (event) => setBasemap(event.target.value));
  $("reloadBtn").addEventListener("click", loadData);
  $("extentBtn").addEventListener("click", zoomToVisibleData);
  $("resetBtn").addEventListener("click", resetFilters);
  $("resetFiltersBtn").addEventListener("click", resetFilters);
  $("selectAllRoutesBtn").addEventListener("click", () => setSelectedRoutes(new Set(routeColors.keys())));
  $("clearRoutesBtn").addEventListener("click", () => setSelectedRoutes(new Set()));
  $("filterPlace").addEventListener("input", () => { drawData(); updateStats(); });
  $("searchInput").addEventListener("input", updateSearchResults);
  $("clearSearchBtn").addEventListener("click", () => {
    clearTimeout(searchTimer);
    activeAddressSearch?.abort();
    $("searchInput").value = "";
    $("searchResults").replaceChildren();
    $("searchResults").style.display = "none";
  });
  $("fullscreenBtn").addEventListener("click", toggleFullscreen);
  $("locateBtn").addEventListener("click", locateUser);
  $("closeSidebarBtn").addEventListener("click", () => $("sidebar").classList.remove("open"));
  $("openSidebarBtn").addEventListener("click", () => $("sidebar").classList.add("open"));

  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab, .tab-panel").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`.tab-panel[data-panel="${tab.dataset.panel}"]`)?.classList.add("active");
  }));
  map.on("moveend", () => {
    updateRouteLabels();
    updateStats();
  });
}

function setSelectedRoutes(refs) {
  selectedRefs = refs;
  routeCheckboxes.forEach((checkbox) => { checkbox.checked = selectedRefs.has(checkbox.value); });
  drawData();
  updateStats();
}

function resetFilters() {
  selectedRefs.clear();
  routeCheckboxes.forEach((checkbox) => { checkbox.checked = false; });
  $("filterPlace").value = "";
  $("searchInput").value = "";
  clearTimeout(searchTimer);
  activeAddressSearch?.abort();
  $("searchResults").replaceChildren();
  $("searchResults").style.display = "none";
  drawData();
  updateStats();
  zoomToVisibleData();
}

function updateSearchResults() {
  const query = $("searchInput").value.trim();
  const results = $("searchResults");
  clearTimeout(searchTimer);
  activeAddressSearch?.abort();
  if (!query) {
    results.replaceChildren();
    results.style.display = "none";
    return;
  }
  const normalizedQuery = query.toLocaleLowerCase("nl");
  const matches = [];
  stopFeatures.forEach((feature) => {
    const properties = feature.properties || {};
    const name = String(properties.name || "");
    const refs = getBusNumbers(properties);
    if (`${name} ${refs.join(" ")}`.toLocaleLowerCase("nl").includes(normalizedQuery)) {
      matches.push({ kind: "stop", feature, title: name || "Bushalte", subtitle: refs.length ? `Bus ${refs.join(", ")}` : "Busnummer niet beschikbaar" });
    }
  });
  routeFeatures.forEach((feature) => {
    const ref = getRouteRef(feature);
    const properties = feature.properties || {};
    const name = String(properties.name || `Lijn ${ref}`);
    if (`${name} ${ref}`.toLocaleLowerCase("nl").includes(normalizedQuery)) {
      matches.push({ kind: "route", feature, title: name, subtitle: `Buslijn ${ref}` });
    }
  });
  const localSuggestions = matches.slice(0, 6);
  renderSearchResults(localSuggestions);
  if (query.length >= 3) {
    searchTimer = window.setTimeout(() => searchAddresses(query, localSuggestions), 300);
  }
}

async function searchAddresses(query, localMatches) {
  const controller = new AbortController();
  activeAddressSearch = controller;
  try {
    const url = new URL(ADDRESS_SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("rows", "6");
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`PDOK antwoordde met HTTP ${response.status}`);
    const data = await response.json();
    if ($("searchInput").value.trim() !== query) return;

    const matches = [...localMatches];
    for (const doc of data.response?.docs || []) {
      const point = parsePdokPoint(doc.centroide_ll);
      if (!point) continue;
      const title = String(doc.weergavenaam || doc.adres || "Adres");
      if (matches.some((match) => match.kind === "address" && match.title === title)) continue;
      matches.push({ kind: "address", title, subtitle: "Adres of plaats • PDOK", point });
    }
    renderSearchResults(matches);
  } catch (error) {
    if (error.name === "AbortError") return;
    if ($("searchInput").value.trim() !== query) return;
    console.error("Adres zoeken mislukt:", error);
    const notice = document.createElement("div");
    notice.className = "search-notice";
    notice.textContent = "Adreszoekdienst is tijdelijk niet beschikbaar.";
    $("searchResults").append(notice);
    $("searchResults").style.display = "block";
  }
}

function parsePdokPoint(value) {
  const match = typeof value === "string" && value.match(/^POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/i);
  if (!match) return null;
  const longitude = Number(match[1]);
  const latitude = Number(match[2]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
      longitude < 3 || longitude > 8 || latitude < 50 || latitude > 54) return null;
  return [latitude, longitude];
}

function renderSearchResults(matches) {
  const results = $("searchResults");
  results.replaceChildren();
  matches.slice(0, 15).forEach((match) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    button.dataset.title = match.title;
    const title = document.createElement("strong");
    const subtitle = document.createElement("small");
    title.textContent = match.title;
    subtitle.textContent = match.subtitle;
    button.append(title, subtitle);
    button.addEventListener("click", () => {
      $("searchResults").style.display = "none";
      if (match.kind === "stop") {
        setSelectedRoutes(new Set());
        $("filterPlace").value = "";
        drawData();
        const [lon, lat] = match.feature.geometry.coordinates;
        map.setView([lat, lon], 16);
        const marker = stopsLayer.getLayers().find((layer) => layer.feature === match.feature);
        marker?.openPopup();
      } else if (match.kind === "route") {
        const ref = getRouteRef(match.feature);
        setSelectedRoutes(new Set([ref]));
        const layer = routesLayer.getLayers().find((item) => item.feature === match.feature);
        if (layer?.getBounds().isValid()) map.fitBounds(layer.getBounds().pad(0.2));
      } else {
        if (addressMarker) map.removeLayer(addressMarker);
        addressMarker = L.circleMarker(match.point, {
          radius: 8,
          color: "#ffffff",
          weight: 3,
          fillColor: "#e05252",
          fillOpacity: 1
        }).addTo(map);
        const popupContent = document.createElement("span");
        popupContent.textContent = match.title;
        addressMarker.bindPopup(popupContent).openPopup();
        map.setView(match.point, 17);
      }
    });
    results.append(button);
  });
  results.style.display = matches.length ? "block" : "none";
}

async function locateUser() {
  if (!navigator.geolocation) {
    showError("Locatie wordt niet ondersteund door deze browser.");
    return;
  }
  $("locateBtn").disabled = true;
  navigator.geolocation.getCurrentPosition((position) => {
    $("locateBtn").disabled = false;
    const location = [position.coords.latitude, position.coords.longitude];
    if (locationMarker) map.removeLayer(locationMarker);
    locationMarker = L.circleMarker(location, {
      radius: 8, color: "#fff", weight: 3, fillColor: "#e05252", fillOpacity: 1
    }).addTo(map).bindPopup("Jouw locatie");
    map.setView(location, 15);
  }, (error) => {
    $("locateBtn").disabled = false;
    showError(`Locatie niet beschikbaar: ${error.message}`);
  }, { enableHighAccuracy: true, timeout: 10000 });
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
    window.setTimeout(() => map.invalidateSize(), 200);
  } catch (error) {
    showError(`Volledig scherm niet beschikbaar: ${error.message}`);
  }
}

buildLegend();
initMap();
