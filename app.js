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
  fullscreenButton: document.querySelector("#fullscreen-button"),
};

let currentData = null;
let refreshTimer = null;
let detailCloseTimer = null;
let selectedPlantOrder = null;
let detailTrigger = null;

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
    card.querySelector(".plant-capacity").textContent = `설비 ${formatPower(plant.capacity_kw)}`;
    const status = card.querySelector(".plant-status");
    status.textContent = statusText;
    status.classList.add(statusClass);

    if (plant.detail_enabled) {
      card.classList.add("interactive");
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", `${plant.short_name} 상세 현황 보기`);
      card.querySelector(".detail-hint").hidden = false;
      card.addEventListener("click", () => openDetail(plant, card));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDetail(plant, card);
        }
      });
    }
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
