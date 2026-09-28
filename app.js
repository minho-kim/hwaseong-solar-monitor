"use strict";

const SUPABASE_URL = "https://ifdqlwxgqgsvnawmhlfc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_lkVhLJDe8WmOPzsWOMkKdg_pjVwVS-h";
const DASHBOARD_SLUG = "hwaseong-renewable-energy";
const DEFAULT_REFRESH_MS = 180_000;

const configuredPlants = [
  [1, "1호기", "RE빛제1호 태양광발전소", "", 189.38, "NREMS"],
  [2, "2호기", "RE빛 제2호기-경기기술학교", "경기기술학교", 134.19, "NREMS"],
  [3, "3호기", "RE빛제3호-경기도농업기술원", "경기도농업기술원", 99.54, "PVEYES"],
  [4, "4호기", "RE빛제4호-산지유통센터 태양광발전소", "산지유통센터", 298.24, "PVEYES", true],
].map(([display_order, short_name, full_name, location_label, capacity_kw, provider, detail_enabled = false]) => ({
  display_order,
  short_name,
  full_name,
  location_label,
  capacity_kw,
  provider,
  detail_enabled,
  current_kw: null,
  today_kwh: null,
  lifetime_kwh: null,
  operational_state: "unknown",
  communication_state: "unknown",
  data_state: "pending",
  fetched_at: null,
  hourly_generation: [],
  weekly_generation: [],
  monthly_generation: [],
  cumulative_generation: [],
}));

const elements = {
  plantGrid: document.querySelector("#plant-grid"),
  template: document.querySelector("#plant-card-template"),
  totalCapacity: document.querySelector("#total-capacity"),
  totalCurrent: document.querySelector("#total-current"),
  totalToday: document.querySelector("#total-today"),
  totalLifetime: document.querySelector("#total-lifetime"),
  plantCount: document.querySelector("#plant-count"),
  updatedAt: document.querySelector("#updated-at"),
  dataState: document.querySelector("#data-state"),
  connectionDot: document.querySelector("#connection-dot"),
  qualityBadge: document.querySelector("#quality-badge"),
  qualityMessage: document.querySelector("#quality-message"),
  sourceList: document.querySelector("#source-list"),
  overlay: document.querySelector("#detail-overlay"),
  detailPanel: document.querySelector("#detail-panel"),
  detailClose: document.querySelector("#detail-close"),
  hourlyChart: document.querySelector("#hourly-chart"),
  hourlyChartValue: document.querySelector("#hourly-chart-value"),
  hourlyChartStatus: document.querySelector("#hourly-chart-status"),
  chartTabs: document.querySelector("#chart-tabs"),
  periodChartEyebrow: document.querySelector("#period-chart-eyebrow"),
  periodChartTitle: document.querySelector("#period-chart-title"),
  fullscreenButton: document.querySelector("#fullscreen-button"),
};

let currentData = null;
let refreshTimer = null;
let detailCloseTimer = null;
let selectedPlantOrder = null;
let detailTrigger = null;
let selectedPeriod = "day";
let selectedDetailPlant = null;

function formatPower(value, { compact = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (number >= 1000 && compact) return `${(number / 1000).toFixed(number >= 10000 ? 1 : 2)} MW`;
  return `${number.toLocaleString("ko-KR", { maximumFractionDigits: number < 10 ? 2 : 1 })} kW`;
}

function formatEnergy(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (number >= 1_000_000) return `${(number / 1_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })} GWh`;
  if (number >= 1000) return `${(number / 1000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })} MWh`;
  return `${number.toLocaleString("ko-KR", { maximumFractionDigits: 1 })} kWh`;
}

function formatChartEnergy(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} kWh`;
}

function normalizeHourlyReadings(readings = []) {
  const byHour = new Map();
  for (const reading of Array.isArray(readings) ? readings : []) {
    const hour = Number(reading?.hour);
    const kwh = Number(reading?.kwh);
    const sampleCount = reading?.sample_count == null ? 1 : Number(reading.sample_count);
    if (
      Number.isInteger(hour) && hour >= 0 && hour <= 23 &&
      Number.isFinite(kwh) && kwh >= 0 && Number.isFinite(sampleCount) &&
      sampleCount > 0 && hour <= currentKstHour()
    ) {
      byHour.set(hour, { kwh, sampleCount });
    }
  }
  return byHour;
}

function formatDateTime(value, timeOnly = false) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: timeOnly ? undefined : "numeric",
    day: timeOnly ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function stateLabel(plant) {
  const labels = {
    generating: ["발전 중", "generating"],
    night: ["발전 종료", "night"],
    stopped: ["발전 확인", "stopped"],
    offline: ["통신 이상", "offline"],
    unknown: [plant.data_state === "pending" ? "연결 대기" : "상태 확인", "unknown"],
  };
  return labels[plant.operational_state] ?? labels.unknown;
}

function communicationLabel(state) {
  const labels = {
    normal: "정상",
    delayed: "수집 지연",
    offline: "통신 이상",
    unknown: "확인 중",
  };
  return labels[state] ?? labels.unknown;
}

function currentKstHour() {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date()));
}

function renderHourlyChart(readings = []) {
  const byHour = normalizeHourlyReadings(readings);

  const collected = [...byHour.entries()];
  const maximum = Math.max(0, ...collected.map(([, value]) => value.kwh));
  const latestHour = collected.at(-1)?.[0] ?? null;
  const fragment = document.createDocumentFragment();

  for (let hour = 0; hour < 24; hour += 1) {
    const reading = byHour.get(hour);
    const hasData = Boolean(reading && reading.sampleCount > 0);
    const column = document.createElement("button");
    column.type = "button";
    column.className = `hourly-column${hasData ? " has-data" : " pending"}${hour === latestHour ? " latest" : ""}`;
    const valueText = hasData ? formatChartEnergy(reading.kwh) : "아직 수집되지 않음";
    column.title = `${hour}시 ${valueText}`;
    column.setAttribute("aria-label", `${hour}시 발전량 ${valueText}`);
    column.disabled = !hasData;

    const plot = document.createElement("span");
    plot.className = "hourly-plot";
    const bar = document.createElement("span");
    bar.className = "hourly-bar";
    const height = hasData
      ? maximum > 0 ? Math.max(3, (reading.kwh / maximum) * 100) : 3
      : 0;
    bar.style.setProperty("--bar-height", `${height}%`);
    plot.append(bar);

    const label = document.createElement("span");
    label.className = "hourly-label";
    label.textContent = [0, 6, 12, 18, 23].includes(hour) ? String(hour) : "";
    column.append(plot, label);
    if (hasData) {
      column.addEventListener("click", () => {
        elements.hourlyChart.querySelectorAll(".hourly-column.selected").forEach((item) => item.classList.remove("selected"));
        column.classList.add("selected");
        elements.hourlyChartValue.textContent = `${hour}시 · ${formatChartEnergy(reading.kwh)}`;
      });
    }
    fragment.append(column);
  }

  elements.hourlyChart.replaceChildren(fragment);
  if (collected.length === 0) {
    elements.hourlyChartValue.textContent = "이력을 모으는 중";
    elements.hourlyChartStatus.textContent = "공급사에서 오늘 시간대 자료를 받으면 그래프가 표시됩니다.";
    return;
  }

  const latest = byHour.get(latestHour);
  elements.hourlyChartValue.textContent = `${latestHour}시 · ${formatChartEnergy(latest.kwh)}`;
  elements.hourlyChartStatus.textContent = "공급사 화면에서 받은 오늘 시간대별 발전량입니다.";
}

function normalizePeriodRows(rows, keyName) {
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const key = String(row?.[keyName] ?? "");
    const kwh = Number(row?.kwh);
    return key && Number.isFinite(kwh) && kwh >= 0 ? [{ key, kwh }] : [];
  }).sort((left, right) => left.key.localeCompare(right.key));
}

function periodLabel(key, period) {
  if (period === "cumulative") return `${Number(key.slice(5, 7))}월`;
  const [, month, day] = key.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function renderPeriodBars(plant, period) {
  const settings = {
    week: {
      rows: normalizePeriodRows(plant.weekly_generation, "date"),
      eyebrow: "최근 7일 발전 흐름",
      title: "일별 발전량",
      status: "최근 7일의 일별 발전량입니다.",
    },
    month: {
      rows: normalizePeriodRows(plant.monthly_generation, "date"),
      eyebrow: "이번 달 발전 흐름",
      title: "일별 발전량",
      status: "이번 달 1일부터 오늘까지의 일별 발전량입니다.",
    },
    cumulative: {
      rows: normalizePeriodRows(plant.cumulative_generation, "month"),
      eyebrow: "누적 발전 흐름 · 최근 13개월",
      title: "월별 발전량",
      status: `그래프는 최근 13개월이며, 전체 누적 발전량은 ${formatEnergy(plant.lifetime_kwh)}입니다.`,
    },
  }[period];
  const rows = settings.rows;
  const maximum = Math.max(0, ...rows.map((row) => row.kwh));
  const fragment = document.createDocumentFragment();
  elements.periodChartEyebrow.textContent = settings.eyebrow;
  elements.periodChartTitle.textContent = settings.title;
  elements.hourlyChart.classList.add("period-chart");
  elements.hourlyChart.setAttribute("aria-label", `${settings.eyebrow} 막대그래프`);
  elements.hourlyChart.style.setProperty("--period-columns", String(Math.max(rows.length, 1)));

  for (const [index, row] of rows.entries()) {
    const column = document.createElement("button");
    column.type = "button";
    column.className = `hourly-column period-column has-data${index === rows.length - 1 ? " latest" : ""}`;
    const labelText = periodLabel(row.key, period);
    column.title = `${labelText} ${formatChartEnergy(row.kwh)}`;
    column.setAttribute("aria-label", `${labelText} 발전량 ${formatChartEnergy(row.kwh)}`);
    const plot = document.createElement("span");
    plot.className = "hourly-plot";
    const bar = document.createElement("span");
    bar.className = "hourly-bar";
    bar.style.setProperty("--bar-height", `${maximum > 0 ? Math.max(3, (row.kwh / maximum) * 100) : 3}%`);
    plot.append(bar);
    const label = document.createElement("span");
    label.className = "hourly-label";
    const showEvery = rows.length > 20 ? 5 : rows.length > 14 ? 3 : 1;
    label.textContent = index % showEvery === 0 || index === rows.length - 1 ? labelText : "";
    column.append(plot, label);
    column.addEventListener("click", () => {
      elements.hourlyChart.querySelectorAll(".hourly-column.selected").forEach((item) => item.classList.remove("selected"));
      column.classList.add("selected");
      elements.hourlyChartValue.textContent = `${labelText} · ${formatChartEnergy(row.kwh)}`;
    });
    fragment.append(column);
  }
  elements.hourlyChart.replaceChildren(fragment);
  elements.hourlyChartStatus.textContent = settings.status;
  if (rows.length === 0) {
    elements.hourlyChartValue.textContent = "기간 자료 준비 중";
    elements.hourlyChartStatus.textContent = "기간별 자료는 자정부터 오전 7시 사이에 하루 한 번 갱신됩니다.";
  } else if (period === "cumulative") {
    elements.hourlyChartValue.textContent = `전체 누적 · ${formatEnergy(plant.lifetime_kwh)}`;
  } else {
    const total = rows.reduce((sum, row) => sum + row.kwh, 0);
    elements.hourlyChartValue.textContent = `${period === "week" ? "7일" : "이번 달"} 합계 · ${formatEnergy(total)}`;
  }
}

function renderDetailChart(plant) {
  for (const tab of elements.chartTabs.querySelectorAll(".chart-tab")) {
    const active = tab.dataset.period === selectedPeriod;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  if (selectedPeriod === "day") {
    elements.periodChartEyebrow.textContent = "오늘 발전 흐름";
    elements.periodChartTitle.textContent = "시간별 발전량";
    elements.hourlyChart.classList.remove("period-chart");
    elements.hourlyChart.setAttribute("aria-label", "오늘 시간별 발전량 막대그래프");
    elements.hourlyChart.style.removeProperty("--period-columns");
    renderHourlyChart(plant.hourly_generation);
    return;
  }
  renderPeriodBars(plant, selectedPeriod);
}

function renderPlantHourlyChart(card, plant) {
  const byHour = normalizeHourlyReadings(plant.hourly_generation);
  const collected = [...byHour.entries()];
  const maximum = Math.max(0, ...collected.map(([, value]) => value.kwh));
  const latestEntry = collected.at(-1);
  const chart = card.querySelector(".plant-hourly-chart");
  const latest = card.querySelector(".plant-hourly-latest");
  const fragment = document.createDocumentFragment();

  for (let hour = 0; hour < 24; hour += 1) {
    const reading = byHour.get(hour);
    const bar = document.createElement("span");
    bar.className = `plant-hourly-bar${reading ? " has-data" : ""}${latestEntry?.[0] === hour ? " latest" : ""}`;
    const height = reading
      ? maximum > 0 ? Math.max(5, (reading.kwh / maximum) * 100) : 5
      : 0;
    bar.style.setProperty("--mini-bar-height", `${height}%`);
    fragment.append(bar);
  }

  chart.replaceChildren(fragment);
  if (latestEntry) {
    latest.textContent = `${latestEntry[0]}시 ${formatChartEnergy(latestEntry[1].kwh)}`;
    card.querySelector(".plant-hourly").setAttribute(
      "aria-label",
      `${plant.short_name} 오늘 시간대별 발전량, 최근 ${latestEntry[0]}시 ${formatChartEnergy(latestEntry[1].kwh)}`,
    );
  } else {
    latest.textContent = "시간대 자료 준비 중";
    card.querySelector(".plant-hourly").setAttribute("aria-label", `${plant.short_name} 시간대 자료 준비 중`);
  }
}

function renderPlants(plants) {
  const plantCount = plants.length;
  const desktopColumns = plantCount <= 5
    ? Math.max(plantCount, 1)
    : plantCount === 6 || plantCount === 9
      ? 3
      : plantCount <= 8
        ? 4
        : 5;
  elements.plantGrid.style.setProperty("--plant-columns", String(desktopColumns));
  elements.plantGrid.dataset.desktopRows = String(Math.ceil(Math.max(plantCount, 1) / desktopColumns));

  const fragment = document.createDocumentFragment();
  for (const plant of plants) {
    const card = elements.template.content.firstElementChild.cloneNode(true);
    card.dataset.plantOrder = String(plant.display_order);
    const [statusText, statusClass] = stateLabel(plant);
    card.querySelector(".plant-number").textContent = plant.short_name;
    card.querySelector(".plant-name").textContent = plant.full_name;
    card.querySelector(".plant-location").textContent = plant.location_label || "화성시";
    card.querySelector(".plant-current").textContent = formatPower(plant.current_kw);
    card.querySelector(".plant-today-energy").textContent = formatChartEnergy(plant.today_kwh);
    card.querySelector(".plant-capacity").textContent = `설비 ${formatPower(plant.capacity_kw)}`;
    const status = card.querySelector(".plant-status");
    status.textContent = statusText;
    status.classList.add(statusClass);

    card.classList.add("interactive");
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `${plant.short_name} ${plant.full_name} 상세 현황 보기`);
    card.querySelector(".detail-hint").hidden = false;
    renderPlantHourlyChart(card, plant);
    card.addEventListener("click", () => openDetail(plant, card));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetail(plant, card);
      }
    });
    fragment.append(card);
  }
  elements.plantGrid.replaceChildren(fragment);
}

function renderSources(sources = []) {
  const fragment = document.createDocumentFragment();
  for (const source of sources) {
    const chip = document.createElement("span");
    const state = source.sync_state === "success" ? "success" : source.sync_state === "error" ? "error" : "idle";
    chip.className = `source-chip ${state}`;
    chip.textContent = `${source.provider} ${state === "success" ? "수집 성공" : state === "error" ? "확인 필요" : "준비 중"}`;
    fragment.append(chip);
  }
  elements.sourceList.replaceChildren(fragment);
}

function renderDashboard(data) {
  currentData = data;
  const plants = Array.isArray(data.plants) ? data.plants : configuredPlants;
  const summary = data.summary ?? {};
  elements.totalCapacity.textContent = formatPower(summary.total_capacity_kw, { compact: true });
  elements.totalCurrent.textContent = formatPower(summary.current_kw, { compact: true });
  elements.totalToday.textContent = formatEnergy(summary.today_kwh);
  elements.totalLifetime.textContent = formatEnergy(summary.lifetime_kwh);
  elements.plantCount.textContent = String(summary.plant_count ?? plants.length);
  elements.updatedAt.textContent = formatDateTime(data.last_updated, true);
  elements.connectionDot.className = "connection-dot online";

  const sources = Array.isArray(data.sources) ? data.sources : [];
  const hasSourceError = sources.some((source) => source.sync_state === "error");
  if (data.is_live) {
    elements.dataState.textContent = "3분 자동 갱신";
    elements.qualityBadge.className = "quality-badge live";
    elements.qualityBadge.textContent = "자동 연동";
    elements.qualityMessage.textContent = "두 사이트에서 수집한 발전소별 상태를 3분마다 갱신합니다.";
  } else if (hasSourceError) {
    elements.dataState.textContent = "부분 연동";
    elements.qualityBadge.className = "quality-badge error";
    elements.qualityBadge.textContent = "연동 확인";
    elements.qualityMessage.textContent = "마지막 수집 성공값을 표시하고 있습니다.";
  } else {
    elements.dataState.textContent = "초기 확인값";
    elements.qualityBadge.className = "quality-badge seed";
    elements.qualityBadge.textContent = "초기 확인값";
    elements.qualityMessage.textContent = "계정 보안 설정 후 자동 갱신으로 전환됩니다.";
  }
  renderSources(sources);
  renderPlants(plants);

  if (selectedPlantOrder !== null) {
    const selected = plants.find((plant) => plant.display_order === selectedPlantOrder);
    if (selected) populateDetail(selected);
  }
}

function renderLoadError() {
  elements.dataState.textContent = "연결 확인";
  elements.updatedAt.textContent = "--:--";
  elements.connectionDot.className = "connection-dot error";
  elements.qualityBadge.className = "quality-badge error";
  elements.qualityBadge.textContent = "데이터 연결 확인";
  elements.qualityMessage.textContent = "잠시 후 자동으로 다시 연결합니다.";
  if (!currentData) {
    elements.totalCapacity.textContent = "721.4 kW";
    elements.totalCurrent.textContent = "--";
    elements.totalToday.textContent = "--";
    elements.totalLifetime.textContent = "--";
    elements.plantCount.textContent = String(configuredPlants.length);
    renderPlants(configuredPlants);
  }
}

async function fetchDashboard() {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_power_monitor`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_slug: DASHBOARD_SLUG }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`dashboard request ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.plants)) throw new Error("dashboard payload invalid");
    renderDashboard(data);

    const interval = Math.max(15, Math.min(3600, Number(data.refresh_seconds) || 60)) * 1000;
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(fetchDashboard, interval);
  } catch (error) {
    console.warn("발전 현황 연결을 다시 시도합니다.", error instanceof Error ? error.message : "unknown");
    renderLoadError();
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(fetchDashboard, DEFAULT_REFRESH_MS);
  }
}

function populateDetail(plant) {
  selectedDetailPlant = plant;
  const [statusText] = stateLabel(plant);
  document.querySelector("#detail-number").textContent = plant.short_name;
  document.querySelector("#detail-title").textContent = plant.full_name;
  document.querySelector("#detail-location").textContent = plant.location_label || "화성시";
  document.querySelector("#detail-capacity").textContent = formatPower(plant.capacity_kw);
  document.querySelector("#detail-provider").textContent = plant.provider;
  document.querySelector("#detail-status").textContent = statusText;
  document.querySelector("#detail-communication").textContent = communicationLabel(plant.communication_state);
  document.querySelector("#detail-current").textContent = formatPower(plant.current_kw);
  document.querySelector("#detail-today").textContent = formatEnergy(plant.today_kwh);
  document.querySelector("#detail-lifetime").textContent = formatEnergy(plant.lifetime_kwh);
  document.querySelector("#detail-updated-at").textContent = formatDateTime(plant.fetched_at);
  renderDetailChart(plant);
}

function setDetailOrigin(sourceCard) {
  if (!sourceCard) {
    elements.detailPanel.style.removeProperty("--detail-origin-x");
    elements.detailPanel.style.removeProperty("--detail-origin-y");
    return;
  }
  const cardRect = sourceCard.getBoundingClientRect();
  const panelRect = elements.detailPanel.getBoundingClientRect();
  const originX = cardRect.left + cardRect.width / 2 - panelRect.left;
  const originY = cardRect.top + cardRect.height / 2 - panelRect.top;
  elements.detailPanel.style.setProperty("--detail-origin-x", `${originX}px`);
  elements.detailPanel.style.setProperty("--detail-origin-y", `${originY}px`);
}

function openDetail(plant, sourceCard) {
  window.clearTimeout(detailCloseTimer);
  selectedPlantOrder = plant.display_order;
  selectedPeriod = "day";
  detailTrigger = sourceCard;
  populateDetail(plant);
  elements.overlay.hidden = false;
  elements.overlay.classList.remove("is-open", "is-closing");
  setDetailOrigin(sourceCard);
  void elements.overlay.offsetWidth;
  elements.overlay.classList.add("is-open");
  document.body.style.overflow = "hidden";
  elements.detailClose.focus();
}

function closeDetail() {
  if (elements.overlay.hidden || elements.overlay.classList.contains("is-closing")) return;
  elements.overlay.classList.remove("is-open");
  elements.overlay.classList.add("is-closing");
  document.body.style.overflow = "";
  selectedPlantOrder = null;
  const trigger = detailTrigger;
  detailTrigger = null;
  detailCloseTimer = window.setTimeout(() => {
    elements.overlay.hidden = true;
    elements.overlay.classList.remove("is-closing");
    const currentTrigger = document.querySelector(`[data-plant-order="${trigger?.dataset.plantOrder ?? ""}"]`);
    if (currentTrigger instanceof HTMLElement) currentTrigger.focus();
  }, 240);
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    if ("wakeLock" in navigator) await navigator.wakeLock.request("screen");
  } catch {
    elements.fullscreenButton.title = "브라우저 메뉴에서 전체 화면을 선택해 주세요";
  }
}

elements.detailClose.addEventListener("click", closeDetail);
elements.chartTabs.addEventListener("click", (event) => {
  const tab = event.target.closest(".chart-tab");
  if (!tab || !selectedDetailPlant) return;
  selectedPeriod = tab.dataset.period;
  renderDetailChart(selectedDetailPlant);
});
elements.chartTabs.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...elements.chartTabs.querySelectorAll(".chart-tab")];
  const currentIndex = tabs.findIndex((tab) => tab.dataset.period === selectedPeriod);
  let nextIndex = currentIndex;
  if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;
  event.preventDefault();
  tabs[nextIndex].click();
  tabs[nextIndex].focus();
});
elements.overlay.addEventListener("click", (event) => {
  if (event.target === elements.overlay) closeDetail();
});
elements.fullscreenButton.addEventListener("click", toggleFullscreen);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.overlay.hidden) closeDetail();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") fetchDashboard();
});

renderPlants(configuredPlants);
fetchDashboard();
