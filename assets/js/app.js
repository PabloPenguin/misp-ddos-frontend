const DATA_URL = "https://raw.githubusercontent.com/PabloPenguin/misp-ddos-events/main/ddos_events.json";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const severityMap = {
  "1": { label: "High", slug: "high", numeric: 3 },
  "2": { label: "Medium", slug: "medium", numeric: 2 },
  "3": { label: "Low", slug: "low", numeric: 1 },
  "4": { label: "Undefined", slug: "undefined", numeric: 0 },
};

const palettes = {
  tlp: {
    "TLP:RED": "#f87171",
    "TLP:AMBER": "#fbbf24",
    "TLP:GREEN": "#4ade80",
    "TLP:CLEAR": "#63b3ff",
    "TLP:WHITE": "#63b3ff",
    "TLP:UNKNOWN": "#94a3b8",
  },
  timeline: "#63b3ff",
  timelineFill: "rgba(99, 179, 255, 0.2)",
  organisations: ["#60a5fa", "#a855f7", "#f472b6", "#fbbf24", "#34d399"],
};

const TLP_ORDER = ["TLP:RED", "TLP:AMBER", "TLP:GREEN", "TLP:CLEAR", "TLP:UNKNOWN"];
const TLP_ALIASES = {
  "TLP:WHITE": "TLP:CLEAR",
  "TLP:AMBER+STRICT": "TLP:AMBER",
};

const charts = {
  tlp: null,
  repeatIps: null,
  timeline: null,
  organisations: null,
};

function resolveTlpLevel(event) {
  if (!event) return null;
  let level = event.tlp_level;
  if (!level || !String(level).trim()) {
    const tlpTag = (event.tags ?? []).find((tag) => /^tlp:/i.test(tag));
    if (tlpTag) {
      const match = tlpTag.match(/^tlp:([a-z0-9+_-]+)/i);
      if (match && match[1]) {
        level = `TLP:${match[1]}`;
      }
    }
  }
  return level ?? null;
}

function normaliseTlpLevel(value) {
  if (!value) return "TLP:UNKNOWN";
  const upper = String(value).trim().toUpperCase();
  if (TLP_ALIASES[upper]) {
    return TLP_ALIASES[upper];
  }
  if (TLP_ORDER.includes(upper)) {
    return upper;
  }
  if (upper.startsWith("TLP:")) {
    const base = upper.split(/[+\s]/)[0];
    if (TLP_ALIASES[base]) return TLP_ALIASES[base];
    if (TLP_ORDER.includes(base)) return base;
  }
  return "TLP:UNKNOWN";
}

function getTlpColor(level) {
  return palettes.tlp[level] ?? palettes.tlp["TLP:UNKNOWN"];
}

const state = {
  rawEvents: [],
  filteredEvents: [],
  metadata: null,
  sort: { column: "date", direction: "desc" },
  filters: {
    search: "",
    severity: "all",
    tlp: "all",
    source: "all",
    startDate: "",
    endDate: "",
  },
  autoRefresh: true,
  refreshTimer: null,
  lastFetchedAt: null,
};

const elements = {
  tableBody: document.querySelector("#events-tbody"),
  resultCount: document.querySelector("#result-count"),
  totalCard: document.querySelector("#summary-total"),
  organisationsCard: document.querySelector("#summary-organisations"),
  indicatorsCard: document.querySelector("#summary-indicators"),
  highCard: document.querySelector("#summary-high"),
  statusText: document.querySelector("#status-text"),
  statusIndicator: document.querySelector("#data-status"),
  lastUpdated: document.querySelector("#last-updated"),
  exportTimestamp: document.querySelector("#export-timestamp"),
  errorBanner: document.querySelector("#error-banner"),
  refreshButton: document.querySelector("#refresh-button"),
  autoRefreshToggle: document.querySelector("#auto-refresh-toggle"),
  themeToggle: document.querySelector("#theme-toggle"),
  severityFilter: document.querySelector("#severity-filter"),
  tlpFilter: document.querySelector("#tlp-filter"),
  sourceFilter: document.querySelector("#source-filter"),
  startDate: document.querySelector("#start-date"),
  endDate: document.querySelector("#end-date"),
  searchInput: document.querySelector("#search-input"),
  exportCsvButton: document.querySelector("#export-csv"),
  tableHeaders: document.querySelectorAll("#events-table thead th[data-sort]"),
  tlpChart: document.querySelector("#tlp-chart"),
  repeatIpChart: document.querySelector("#repeat-ip-chart"),
  timelineChart: document.querySelector("#timeline-chart"),
  topOrgChart: document.querySelector("#top-org-chart"),
  tlpLegend: document.querySelector("#tlp-legend"),
  repeatIpLegend: document.querySelector("#repeat-ip-legend"),
  timelineLegend: document.querySelector("#timeline-legend"),
  orgLegend: document.querySelector("#org-legend"),
};

function init() {
  restorePreferences();
  bindEvents();
  setupCharts();
  fetchAndRender();
  if (state.autoRefresh) {
    startAutoRefresh();
  }
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", () => fetchAndRender({ manual: true }));

  elements.autoRefreshToggle.addEventListener("change", (event) => {
    state.autoRefresh = event.target.checked;
    persistPreference("autoRefresh", state.autoRefresh);
    if (state.autoRefresh) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  elements.themeToggle.addEventListener("click", toggleTheme);

  elements.severityFilter.addEventListener("change", () => {
    state.filters.severity = elements.severityFilter.value;
    applyFilters();
  });

  elements.tlpFilter.addEventListener("change", () => {
    state.filters.tlp = elements.tlpFilter.value;
    applyFilters();
  });

  elements.sourceFilter.addEventListener("change", () => {
    state.filters.source = elements.sourceFilter.value;
    applyFilters();
  });

  elements.startDate.addEventListener("change", () => {
    state.filters.startDate = elements.startDate.value;
    applyFilters();
  });

  elements.endDate.addEventListener("change", () => {
    state.filters.endDate = elements.endDate.value;
    applyFilters();
  });

  elements.searchInput.addEventListener(
    "input",
    debounce((event) => {
      state.filters.search = event.target.value.trim().toLowerCase();
      applyFilters();
    }, 250)
  );

  elements.exportCsvButton.addEventListener("click", exportCsv);

  elements.tableHeaders.forEach((header) => {
    header.addEventListener("click", () => {
      const column = header.dataset.sort;
      setSort(column);
      applyFilters();
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (!state.autoRefresh) return;
    if (document.visibilityState === "visible") {
      fetchAndRender({ skipLoadingState: true });
    }
  });
}

async function fetchAndRender(options = {}) {
  const { manual = false, skipLoadingState = false } = options;

  if (!skipLoadingState) {
    setLoadingState(true);
    updateStatus("loading", "Fetching latest events…");
  }

  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Source responded with ${response.status}`);
    }

    const payload = await response.json();
    const { export_metadata: metadata = null, events = [] } = payload;

    state.metadata = metadata;
    state.rawEvents = events.map(normaliseEvent);
    state.lastFetchedAt = new Date();

    populateDynamicFilters();
    applyFilters();
    updateExportMetadata();
    hideError();

    const updatedLabel = manual ? "Manual refresh completed" : "Live data up to date";
    updateStatus("online", updatedLabel);
    updateLastUpdated();
  } catch (error) {
    console.error("Failed to fetch events", error);
    updateStatus("offline", "Data refresh failed");
    showError(`Unable to load events. ${error.message}`);
  } finally {
    setLoadingState(false);
  }
}

function normaliseEvent(event) {
  const severity = severityMap[event.threat_level] ?? severityMap["4"];
  const tlp = normaliseTlpLevel(resolveTlpLevel(event));
  const timestampMs = event.timestamp ? Number(event.timestamp) * 1000 : null;
  const eventDate = event.date ? `${event.date}T00:00:00Z` : null;
  const srcIps = extractAttributeValues(event, ["ip-src"]);
  const dstIps = extractAttributeValues(event, ["ip-dst"]);
  const hostnames = extractAttributeValues(event, ["hostname", "domain", "domain|ip"]);
  const urls = extractAttributeValues(event, ["url", "link"]);

  const searchableParts = [
    event.event_id,
    event.info,
    event.org_name,
  tlp,
    ...(event.tags ?? []),
    ...srcIps,
    ...dstIps,
    ...hostnames,
    ...urls,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return {
    id: event.event_id,
    uuid: event.event_uuid,
    info: event.info ?? "Untitled event",
    date: event.date ?? null,
    dateIso: eventDate,
    timestamp: timestampMs,
  tlp,
  tlpSlug: tlp.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    published: Boolean(event.published),
    organisation: event.org_name ?? "Unknown",
    attributeCount: event.attribute_count ?? event.attributes?.length ?? 0,
    tags: event.tags ?? [],
    attributes: event.attributes ?? [],
  objects: event.objects ?? [],
    relatedEvents: event.related_events ?? [],
    severity,
    severityLabel: severity.label,
    severitySlug: severity.slug,
    srcIps,
    dstIps,
    hostnames,
    urls,
    searchIndex: searchableParts.join(" "),
  };
}

function extractAttributeValues(event, types) {
  if (!Array.isArray(event.attributes)) return [];
  return event.attributes
    .filter((attribute) => types.includes(attribute.type))
    .map((attribute) => attribute.value)
    .filter(Boolean);
}

function applyFilters() {
  const { search, severity, tlp, source, startDate, endDate } = state.filters;

  const filtered = state.rawEvents.filter((event) => {
    if (search && !event.searchIndex.includes(search)) {
      return false;
    }

    if (severity !== "all" && event.severitySlug !== severity) {
      // Treat high filter as inclusive of highest severity only.
      return false;
    }

    if (tlp !== "all" && event.tlp !== tlp) {
      return false;
    }

    if (source !== "all" && event.organisation !== source) {
      return false;
    }

    if (startDate) {
      const start = new Date(`${startDate}T00:00:00Z`).getTime();
      const eventTime = event.timestamp ?? (event.dateIso ? Date.parse(event.dateIso) : null);
      if (eventTime && eventTime < start) {
        return false;
      }
    }

    if (endDate) {
      const end = new Date(`${endDate}T23:59:59Z`).getTime();
      const eventTime = event.timestamp ?? (event.dateIso ? Date.parse(event.dateIso) : null);
      if (eventTime && eventTime > end) {
        return false;
      }
    }

    return true;
  });

  const sorted = applySort(filtered);
  state.filteredEvents = sorted;

  renderTable(sorted);
  updateSummary(sorted);
  updateResultCount(sorted.length);
  updateSortIndicators();
  updateVisualisations(sorted);
}

function applySort(events) {
  const { column, direction } = state.sort;
  const sorted = [...events];

  const multiplier = direction === "asc" ? 1 : -1;

  const comparators = {
    date: (a, b) => {
      const aTime = a.timestamp ?? (a.dateIso ? Date.parse(a.dateIso) : 0);
      const bTime = b.timestamp ?? (b.dateIso ? Date.parse(b.dateIso) : 0);
      return aTime - bTime;
    },
    info: (a, b) => compareString(a.info, b.info),
    severity: (a, b) => (a.severity.numeric - b.severity.numeric) || compareString(a.info, b.info),
    tlp: (a, b) => compareString(a.tlp, b.tlp),
    org: (a, b) => compareString(a.organisation, b.organisation),
    srcCount: (a, b) => a.srcIps.length - b.srcIps.length,
    dstCount: (a, b) => a.dstIps.length - b.dstIps.length,
    attributes: (a, b) => a.attributeCount - b.attributeCount,
  };

  const compare = comparators[column] ?? (() => 0);
  sorted.sort((a, b) => compare(a, b) * multiplier);
  return sorted;
}

function compareString(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { sensitivity: "base" });
}

function setSort(column) {
  if (state.sort.column === column) {
    state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
  } else {
    state.sort.column = column;
    state.sort.direction = column === "date" ? "desc" : "asc";
  }
}

function renderTable(events) {
  elements.tableBody.innerHTML = "";

  if (events.length === 0) {
    const emptyRow = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.innerHTML = '<div class="placeholder">No events match the current filters.</div>';
    emptyRow.appendChild(cell);
    elements.tableBody.appendChild(emptyRow);
    return;
  }

  const fragment = document.createDocumentFragment();

  events.forEach((event) => {
    const row = document.createElement("tr");
    row.classList.add("event-row");
    row.dataset.eventId = event.id;
    row.tabIndex = 0;
    row.setAttribute("aria-expanded", "false");

    row.innerHTML = `
      <td>${formatDateCell(event)}</td>
      <td>
        <div class="event-title">${escapeHtml(event.info)}</div>
        <div class="event-meta">UUID: ${escapeHtml(event.uuid)}</div>
      </td>
      <td>${renderSeverityBadge(event)}</td>
      <td><span class="badge badge-tlp">${escapeHtml(event.tlp)}</span></td>
      <td>${escapeHtml(event.organisation)}</td>
      <td>${event.srcIps.length}</td>
      <td>${event.dstIps.length}</td>
      <td>${event.attributeCount}</td>
      <td>
        <button type="button" class="button button-secondary button-small" data-action="toggle-details">
          Details
        </button>
      </td>
    `;

    const toggleDetailsButton = row.querySelector('[data-action="toggle-details"]');

    const detailRow = document.createElement("tr");
    detailRow.classList.add("event-details", "hidden");
    detailRow.dataset.eventId = event.id;

    detailRow.innerHTML = `
      <td colspan="9">
        <div class="detail-panel">
          <div class="detail-grid">
            <section class="detail-section">
              <h3>Summary</h3>
              <p><strong>Published:</strong> ${event.published ? "Yes" : "No"}</p>
              <p><strong>Organisation:</strong> ${escapeHtml(event.organisation)}</p>
              <p><strong>Indicators:</strong> ${event.attributeCount}</p>
              <p><strong>TLP:</strong> ${escapeHtml(event.tlp)}</p>
            </section>
            <section class="detail-section">
              <h3>Source IPs</h3>
              ${renderList(event.srcIps)}
            </section>
            <section class="detail-section">
              <h3>Destination IPs</h3>
              ${renderList(event.dstIps)}
            </section>
            <section class="detail-section">
              <h3>Hostnames</h3>
              ${renderList(event.hostnames)}
            </section>
          </div>
          ${renderTags(event.tags)}
          ${renderAttributes(event.attributes)}
          ${renderObjects(event.objects)}
          ${renderRelatedEvents(event.relatedEvents)}
        </div>
      </td>
    `;

    const toggleDetails = () => {
      const isHidden = detailRow.classList.toggle("hidden");
      row.setAttribute("aria-expanded", String(!isHidden));
    };

    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      toggleDetails();
    });
    row.addEventListener("keypress", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleDetails();
      }
    });

    toggleDetailsButton?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleDetails();
    });

    fragment.appendChild(row);
    fragment.appendChild(detailRow);
  });

  elements.tableBody.appendChild(fragment);
}

function renderSeverityBadge(event) {
  const cls = `badge badge-${event.severitySlug}`;
  return `<span class="${cls}">${escapeHtml(event.severityLabel)}</span>`;
}

function renderList(values) {
  if (!values.length) {
    return "<p class=\"muted\">—</p>";
  }
  const items = values
    .map((value) => `<li>${escapeHtml(value)}</li>`)
    .join("");
  return `<ul class="attribute-list">${items}</ul>`;
}

function renderTags(tags) {
  if (!tags.length) return "";
  const items = tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("");
  return `
    <section class="detail-section">
      <h3>Tags</h3>
      <ul class="tag-cloud">${items}</ul>
    </section>
  `;
}

function renderAttributes(attributes) {
  if (!attributes.length) return "";
  const items = attributes
    .map(
      (attribute) =>
        `<li><strong>${escapeHtml(attribute.type)}</strong>: ${escapeHtml(attribute.value)}</li>`
    )
    .join("");

  return `
    <section class="detail-section">
      <h3>Attributes</h3>
      <ul class="attribute-list">${items}</ul>
    </section>
  `;
}

function renderRelatedEvents(relatedEvents) {
  if (!Array.isArray(relatedEvents) || !relatedEvents.length) return "";
  const items = relatedEvents
    .map((related) => `<li>${escapeHtml(related.info)} (ID ${escapeHtml(related.id)})</li>`)
    .join("");

  return `
    <section class="detail-section">
      <h3>Related events</h3>
      <ul class="attribute-list">${items}</ul>
    </section>
  `;
}

function renderObjects(objects) {
  if (!Array.isArray(objects) || !objects.length) return "";

  const items = objects
    .map((object) => {
      const title = escapeHtml(object.name ?? object.template_uuid ?? "Unnamed object");
      const meta = escapeHtml(object.meta_category ?? object.category ?? "");
      const attr = Array.isArray(object.Attribute) ? object.Attribute : [];
      const attrItems = attr
        .map((attribute) => `<li><strong>${escapeHtml(attribute.type)}</strong>: ${escapeHtml(attribute.value)}</li>`)
        .join("");

      const details = attrItems
        ? `<ul class="attribute-list">${attrItems}</ul>`
        : '<p class="muted">No embedded attributes</p>';

      const description = object.description
        ? `<p class="object-description">${escapeHtml(object.description)}</p>`
        : "";

      return `
        <li>
          <div class="object-header">
            <span class="object-title">${title}</span>
            ${meta ? `<span class="object-meta">${meta}</span>` : ""}
          </div>
          ${description}
          ${details}
        </li>
      `;
    })
    .join("");

  return `
    <section class="detail-section">
      <h3>Objects</h3>
      <ul class="object-list">${items}</ul>
    </section>
  `;
}

function updateSummary(events) {
  const uniqueSources = new Set(events.map((event) => event.organisation)).size;
  const totalIndicators = events.reduce((sum, event) => sum + event.attributeCount, 0);
  const highSeverity = events.filter((event) => event.severitySlug === "high").length;

  elements.totalCard.textContent = events.length.toLocaleString();
  elements.organisationsCard.textContent = uniqueSources.toLocaleString();
  elements.indicatorsCard.textContent = totalIndicators.toLocaleString();
  elements.highCard.textContent = highSeverity.toLocaleString();
}

function updateResultCount(count) {
  elements.resultCount.textContent = `${count.toLocaleString()} event${count === 1 ? "" : "s"}`;
}

function updateExportMetadata() {
  if (!state.metadata?.export_date) {
    elements.exportTimestamp.textContent = "—";
    return;
  }
  const exported = new Date(state.metadata.export_date);
  elements.exportTimestamp.textContent = exported.toLocaleString();
}

function populateDynamicFilters() {
  const tlps = new Set();
  const sources = new Set();

  state.rawEvents.forEach((event) => {
    tlps.add(event.tlp);
    sources.add(event.organisation);
  });

  populateSelect(elements.tlpFilter, tlps, "All TLP levels");
  populateSelect(elements.sourceFilter, sources, "All organisations");
}

function populateSelect(select, values, defaultLabel) {
  const currentValue = select.value;
  const options = [`<option value="all">${defaultLabel}</option>`];
  [...values]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .forEach((value) => {
      options.push(`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`);
    });

  select.innerHTML = options.join("");
  if (values.has(currentValue)) {
    select.value = currentValue;
  } else {
    state.filters[select.id.replace("-filter", "")] = "all";
  }
}

function updateLastUpdated() {
  if (!state.lastFetchedAt) {
    elements.lastUpdated.textContent = "—";
    return;
  }
  elements.lastUpdated.textContent = `${state.lastFetchedAt.toLocaleString()}`;
}

function updateStatus(status, text) {
  elements.statusIndicator.classList.remove("is-online", "is-offline", "is-loading");
  elements.statusText.textContent = text;

  if (status === "online") {
    elements.statusIndicator.classList.add("is-online");
  } else if (status === "offline") {
    elements.statusIndicator.classList.add("is-offline");
  } else {
    elements.statusIndicator.classList.add("is-loading");
  }
}

function setLoadingState(isLoading) {
  elements.refreshButton.disabled = isLoading;
  if (isLoading) {
    elements.refreshButton.dataset.label = elements.refreshButton.textContent;
    elements.refreshButton.textContent = "Refreshing…";
  } else if (elements.refreshButton.dataset.label) {
    elements.refreshButton.textContent = elements.refreshButton.dataset.label;
  }
}

function showError(message) {
  elements.errorBanner.textContent = message;
  elements.errorBanner.hidden = false;
}

function hideError() {
  elements.errorBanner.hidden = true;
  elements.errorBanner.textContent = "";
}

function startAutoRefresh() {
  stopAutoRefresh();
  state.refreshTimer = window.setInterval(() => fetchAndRender({ skipLoadingState: true }), REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

function exportCsv() {
  if (!state.filteredEvents.length) {
    showError("Nothing to export; adjust filters to include at least one event.");
    return;
  }

  const header = [
    "Event ID",
    "UUID",
    "Event",
    "Date",
    "Severity",
    "TLP",
    "Organisation",
    "Published",
    "Source IPs",
    "Destination IPs",
    "Indicators",
    "Tags",
  ];

  const rows = state.filteredEvents.map((event) => [
    event.id,
    event.uuid,
    event.info,
    formatDateCell(event, { plain: true }),
    event.severityLabel,
    event.tlp,
    event.organisation,
    event.published ? "Yes" : "No",
    event.srcIps.join(" | "),
    event.dstIps.join(" | "),
    event.attributeCount,
    event.tags.join(" | "),
  ]);

  const csv = [header, ...rows]
    .map((line) => line.map(escapeCsvValue).join(","))
    .join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `misp-ddos-events-${formatDateForFilename(new Date())}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeCsvValue(value) {
  const safe = String(value ?? "");
  if (safe.includes(",") || safe.includes("\"") || safe.includes("\n")) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function formatDateForFilename(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes()
  )}`;
}

function formatDateCell(event, options = {}) {
  if (event.timestamp) {
    const date = new Date(event.timestamp);
    return options.plain ? date.toISOString() : date.toLocaleString();
  }
  if (event.date) {
    return event.date;
  }
  return "—";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function debounce(callback, delay = 300) {
  let timerId;
  return (...args) => {
    window.clearTimeout(timerId);
    timerId = window.setTimeout(() => callback(...args), delay);
  };
}

function toggleTheme() {
  const root = document.documentElement;
  const isLight = root.classList.toggle("theme-light");
  elements.themeToggle.setAttribute("aria-pressed", String(isLight));
  persistPreference("theme", isLight ? "light" : "dark");
  refreshChartStyling();
}

function restorePreferences() {
  const storedTheme = window.localStorage.getItem("misp-ddos-dashboard-theme");
  if (storedTheme === "light") {
    document.documentElement.classList.add("theme-light");
    elements.themeToggle.setAttribute("aria-pressed", "true");
  } else if (storedTheme === "dark") {
    elements.themeToggle.setAttribute("aria-pressed", "false");
  } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    document.documentElement.classList.add("theme-light");
    elements.themeToggle.setAttribute("aria-pressed", "true");
  }

  const storedAutoRefresh = window.localStorage.getItem("misp-ddos-dashboard-autoRefresh");
  if (storedAutoRefresh !== null) {
    state.autoRefresh = storedAutoRefresh === "true";
    elements.autoRefreshToggle.checked = state.autoRefresh;
  }
}

function persistPreference(key, value) {
  const storageKey = `misp-ddos-dashboard-${key}`;
  window.localStorage.setItem(storageKey, value);
}

function updateSortIndicators() {
  elements.tableHeaders.forEach((header) => {
    header.classList.remove("sorted-asc", "sorted-desc");
    if (header.dataset.sort === state.sort.column) {
      header.classList.add(state.sort.direction === "asc" ? "sorted-asc" : "sorted-desc");
    }
  });
}

function setupCharts() {
  if (typeof Chart === "undefined") {
    console.warn("Chart.js library not loaded; visualisations disabled");
    return;
  }

  Chart.defaults.font.family = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue("--color-text").trim();

  if (elements.tlpChart) {
    charts.tlp = new Chart(elements.tlpChart, {
      type: "doughnut",
      data: {
        labels: [],
        datasets: [
          {
            data: [],
            backgroundColor: [],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "60%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.label}: ${context.formattedValue} events`,
            },
          },
        },
      },
    });
  }

  if (elements.timelineChart) {
    charts.timeline = new Chart(elements.timelineChart, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            data: [],
            tension: 0.35,
            fill: true,
            backgroundColor: palettes.timelineFill,
            borderColor: palettes.timeline,
            pointRadius: 3,
            pointBackgroundColor: palettes.timeline,
            pointBorderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            grid: { color: "rgba(148, 163, 184, 0.18)" },
          },
          x: {
            grid: { display: false },
          },
        },
        plugins: { legend: { display: false } },
      },
    });
  }

  if (elements.repeatIpChart) {
    charts.repeatIps = new Chart(elements.repeatIpChart, {
      type: "bar",
      data: {
        labels: [],
        datasets: [
          {
            data: [],
            backgroundColor: palettes.organisations,
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        scales: {
          x: {
            beginAtZero: true,
            ticks: { precision: 0 },
            grid: { color: "rgba(148, 163, 184, 0.18)" },
          },
          y: {
            grid: { display: false },
          },
        },
        plugins: { legend: { display: false } },
      },
    });
  }

  if (elements.topOrgChart) {
    charts.organisations = new Chart(elements.topOrgChart, {
      type: "bar",
      data: {
        labels: [],
        datasets: [
          {
            data: [],
            backgroundColor: palettes.organisations,
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        scales: {
          x: {
            beginAtZero: true,
            ticks: { precision: 0 },
            grid: { color: "rgba(148, 163, 184, 0.18)" },
          },
          y: {
            grid: { display: false },
          },
        },
        plugins: { legend: { display: false } },
      },
    });
  }

  refreshChartStyling();
}

function updateVisualisations(events) {
  if (!charts.tlp && !charts.repeatIps && !charts.timeline && !charts.organisations) return;
  updateTlpChart(events);
  updateRepeatIpChart(events);
  updateTimelineChart(events);
  updateOrganisationChart(events);
}

function updateTlpChart(events) {
  if (!charts.tlp) return;
  const counts = new Map();
  events.forEach((event) => {
    const tlp = event.tlp ?? "TLP:UNKNOWN";
    counts.set(tlp, (counts.get(tlp) ?? 0) + 1);
  });

  const configuredLevels = Array.isArray(state.metadata?.filter_criteria?.tlp_levels)
    ? state.metadata.filter_criteria.tlp_levels.map((level) => normaliseTlpLevel(level))
    : [];
  configuredLevels.forEach((level) => counts.set(level, counts.get(level) ?? 0));
  TLP_ORDER.forEach((level) => counts.set(level, counts.get(level) ?? 0));

  const orderedLevels = TLP_ORDER.filter((level) => counts.has(level));
  const additionalLevels = Array.from(counts.keys()).filter((level) => !TLP_ORDER.includes(level));
  additionalLevels.sort();
  const labels = [...orderedLevels, ...additionalLevels];
  const data = labels.map((level) => counts.get(level));

  charts.tlp.data.labels = labels;
  charts.tlp.data.datasets[0].data = data;
  charts.tlp.data.datasets[0].backgroundColor = labels.map((level) => getTlpColor(level));
  charts.tlp.update();

  if (!labels.length) {
    renderLegend(elements.tlpLegend, [
      { label: "TLP levels", color: getTlpColor("TLP:UNKNOWN"), detail: "No events in view" },
    ]);
    return;
  }

  const totalCount = data.reduce((sum, value) => sum + value, 0) || 1;
  const legendItems = labels.map((level, index) => {
    const value = data[index];
    const percentage = Math.round((value / totalCount) * 100);
    return {
      label: level,
      color: getTlpColor(level),
      detail: `${value.toLocaleString()} events (${percentage}%)`,
    };
  });

  renderLegend(elements.tlpLegend, legendItems);
}

function updateRepeatIpChart(events) {
  if (!charts.repeatIps) return;
  const counts = new Map();
  events.forEach((event) => {
    event.srcIps.forEach((ip) => {
      counts.set(ip, (counts.get(ip) ?? 0) + 1);
    });
  });

  const totalIps = counts.size;
  const repeated = Array.from(counts.entries()).filter(([, value]) => value > 1);
  repeated.sort((a, b) => b[1] - a[1]);
  const top = repeated.slice(0, 8);

  charts.repeatIps.data.labels = top.map(([ip]) => ip);
  charts.repeatIps.data.datasets[0].data = top.map(([, value]) => value);
  charts.repeatIps.data.datasets[0].backgroundColor = top.map(
    (_, index) => palettes.organisations[index % palettes.organisations.length]
  );
  charts.repeatIps.update();

  let legendItems;

  if (totalIps === 0) {
    legendItems = [
      {
        label: "Attacker IPs",
        color: palettes.organisations[0],
        detail: "No source IP indicators present",
      },
    ];
  } else if (!repeated.length) {
    legendItems = [
      {
        label: "Unique attackers",
        color: palettes.organisations[0],
        detail: `${totalIps.toLocaleString()} IPs observed once`,
      },
      {
        label: "Repeat offenders",
        color: palettes.organisations[1 % palettes.organisations.length],
        detail: "None detected",
      },
    ];
  } else {
    const repeatCount = repeated.length;
    const repeatOccurrences = repeated.reduce((sum, [, value]) => sum + value, 0);
    const topOffender = top[0];
    const reuseRate = Math.round((repeatCount / totalIps) * 100);

    legendItems = [
      {
        label: "Total attackers",
        color: palettes.organisations[0],
        detail: `${totalIps.toLocaleString()} unique IPs`,
      },
      {
        label: "Repeat offenders",
        color: palettes.organisations[1 % palettes.organisations.length],
        detail: `${repeatCount.toLocaleString()} IPs reused (${reuseRate}% of attackers)`,
      },
      {
        label: "Most reused",
        color: palettes.organisations[2 % palettes.organisations.length],
        detail: `${topOffender[0]} (${topOffender[1]} sightings)`,
      },
    ];
  }

  renderLegend(elements.repeatIpLegend, legendItems);
}

function updateTimelineChart(events) {
  if (!charts.timeline) return;
  const counts = new Map();
  events.forEach((event) => {
    const dateKey = event.date ?? (event.timestamp ? new Date(event.timestamp).toISOString().slice(0, 10) : null);
    if (!dateKey) return;
    counts.set(dateKey, (counts.get(dateKey) ?? 0) + 1);
  });
  const labels = Array.from(counts.keys()).sort();
  const data = labels.map((label) => counts.get(label));
  charts.timeline.data.labels = labels;
  charts.timeline.data.datasets[0].data = data;
  charts.timeline.update();

  if (labels.length === 0) {
    renderLegend(elements.timelineLegend, [
      { label: "Activity", color: palettes.timeline, detail: "No dated events in view" },
    ]);
    return;
  }

  const total = data.reduce((sum, value) => sum + value, 0);
  const peakIndex = data.indexOf(Math.max(...data));
  const peakDate = labels[peakIndex];
  const legendItems = [
    { label: "Total events", color: palettes.timeline, detail: total.toLocaleString() },
    { label: "Peak day", color: palettes.timeline, detail: `${formatHumanDate(peakDate)} (${data[peakIndex]})` },
    {
      label: "Date span",
      color: palettes.timeline,
      detail: `${formatHumanDate(labels[0])} – ${formatHumanDate(labels[labels.length - 1])}`,
    },
  ];
  renderLegend(elements.timelineLegend, legendItems);
}

function updateOrganisationChart(events) {
  if (!charts.organisations) return;
  const counts = new Map();
  events.forEach((event) => {
    counts.set(event.organisation, (counts.get(event.organisation) ?? 0) + 1);
  });
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const topFive = sorted.slice(0, 5);
  charts.organisations.data.labels = topFive.map(([label]) => label);
  charts.organisations.data.datasets[0].data = topFive.map(([, value]) => value);
  charts.organisations.update();

  if (!topFive.length) {
    renderLegend(elements.orgLegend, [
      { label: "Top sources", color: palettes.organisations[0], detail: "No organisations in view" },
    ]);
    return;
  }

  const legendItems = topFive.map(([label, value], index) => ({
    label,
    color: palettes.organisations[index % palettes.organisations.length],
    detail: `${value.toLocaleString()} event${value === 1 ? "" : "s"}`,
  }));
  renderLegend(elements.orgLegend, legendItems);
}

function renderLegend(container, items) {
  if (!container) return;
  container.innerHTML = "";
  items.forEach((item) => {
    const dt = document.createElement("dt");
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.backgroundColor = item.color;
    dt.appendChild(swatch);
    const text = document.createTextNode(` ${item.label}`);
    dt.appendChild(text);

    const dd = document.createElement("dd");
    dd.textContent = item.detail;

    container.appendChild(dt);
    container.appendChild(dd);
  });
}

function formatHumanDate(dateString) {
  if (!dateString) return "Unknown";
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function refreshChartStyling() {
  if (typeof Chart === "undefined") return;
  const computed = getComputedStyle(document.documentElement);
  const textColor = computed.getPropertyValue("--color-text").trim();
  const borderColor = computed.getPropertyValue("--color-border").trim() || "rgba(148, 163, 184, 0.18)";
  Chart.defaults.color = textColor;

  if (charts.timeline) {
    charts.timeline.options.scales.x.grid.color = "transparent";
    charts.timeline.options.scales.y.grid.color = borderColor;
    charts.timeline.options.scales.y.ticks.color = textColor;
    charts.timeline.options.scales.x.ticks.color = textColor;
    charts.timeline.update("none");
  }

  if (charts.repeatIps) {
    charts.repeatIps.options.scales.x.grid.color = borderColor;
    charts.repeatIps.options.scales.x.ticks.color = textColor;
    charts.repeatIps.options.scales.y.ticks.color = textColor;
    charts.repeatIps.update("none");
  }

  if (charts.organisations) {
    charts.organisations.options.scales.x.grid.color = borderColor;
    charts.organisations.options.scales.x.ticks.color = textColor;
    charts.organisations.options.scales.y.ticks.color = textColor;
    charts.organisations.update("none");
  }

  if (charts.tlp) {
    charts.tlp.update("none");
  }
}

window.addEventListener("load", init);
