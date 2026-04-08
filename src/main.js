import './style.css';
import {
  enrichRoutesWithRealtime,
  getAppMeta,
  hasTransitApiKey,
  resolveBusSegmentStops,
  reverseGeocode,
  searchPlaces,
  searchTransitRoutes,
} from './api.js';
import { getCurrentPosition } from './geo.js';
import { createTransitMap } from './map.js';
import { loadSavedPlaces, saveSavedPlace } from './storage.js';
import {
  TRANSPORT_ICONS,
  debounce,
  formatDateTime,
  formatDuration,
  formatFare,
  formatMinutesLabel,
  formatTime,
  getRouteSortTime,
  highlightMatch,
  sortRoutes,
  toLocalDateTimeValue,
} from './utils.js';

const $ = (selector) => document.querySelector(selector);

const COPY = {
  originIdle: '출발지를 검색하거나 현재 위치 버튼을 눌러 주세요.',
  originLoading: '출발지를 불러오는 중입니다.',
  destIdle: '도착지를 입력하면 추천 장소가 나타납니다.',
  readyToSearch: '출발지와 도착지를 모두 확정하면 경로를 찾을 수 있습니다.',
  apiOffline: '장소 검색 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  liveMode: '실시간 API 연결',
  demoMode: '데모 모드',
  gpsLoading: '현재 위치를 확인하는 중입니다.',
  gpsDenied: '위치 권한을 사용할 수 없습니다. 검색이나 저장 장소로 출발지를 선택해 주세요.',
  fallbackOrigin: '서울시청',
  currentOrigin: '현재 위치',
  fallbackOriginHint: '위치 권한이 없어 서울시청을 기본 출발지로 사용했습니다.',
  originSelected: '현재 위치를 출발지로 설정했습니다.',
  originReselect: '출발지를 자동완성 목록에서 다시 선택해 주세요.',
  destReselect: '도착지를 자동완성 목록에서 다시 선택해 주세요.',
  loadingPlaces: '장소 후보를 불러오는 중입니다.',
  selectFromList: '목록에서 원하는 장소를 선택해 확정해 주세요.',
  noPlaces: '검색 결과가 없습니다. 다른 키워드로 다시 시도해 주세요.',
  placeSearchError: '장소 검색 중 오류가 발생했습니다.',
  enterHint: 'Enter 대신 목록에서 장소를 선택해 주세요.',
  swapWarning: '출발지와 도착지가 모두 확정되어야 서로 바꿀 수 있습니다.',
  swapped: '출발지와 도착지를 서로 바꿨습니다.',
  saveFirst: '먼저 도착지를 선택한 뒤 저장해 주세요.',
  savedHome: '현재 도착지를 집으로 저장했습니다.',
  savedOffice: '현재 도착지를 회사로 저장했습니다.',
  loadedOriginHome: '집을 출발지로 불러왔습니다.',
  loadedOriginOffice: '회사를 출발지로 불러왔습니다.',
  loadedDestHome: '집을 도착지로 불러왔습니다.',
  loadedDestOffice: '회사를 도착지로 불러왔습니다.',
  noSavedPlace: '저장된 장소가 없습니다. 먼저 도착지를 집 또는 회사로 저장해 주세요.',
  mustConfirmOrigin: '출발지는 자동완성 목록 또는 현재 위치로 확정해야 합니다.',
  mustConfirmDestination: '도착지는 자동완성 목록에서 선택해야 확정됩니다.',
  needBothPlaces: '출발지와 도착지를 모두 확정해 주세요.',
  transitKeyMissing: 'ODSAY 키가 설정되지 않았습니다. VITE_ODSAY_API_KEY를 확인해 주세요.',
  searchingRoutes: '대중교통 경로를 계산하는 중입니다.',
  etaLoading: '실시간 버스 도착정보를 반영해 경로를 보정하는 중입니다.',
  searchFailed: '경로 조회에 실패했습니다.',
  noRouteYet: '아직 선택된 경로가 없습니다.',
  foundRoutes: (count) => `${count}개의 추천 경로를 찾았습니다.`,
  noRoutes: '조건에 맞는 경로를 찾지 못했습니다.',
  loadingRoutes: '경로를 불러오는 중입니다...',
  confirmed: '확정',
  searching: '검색 중',
  notConfirmed: '미확정',
  noAddress: '주소 정보 없음',
  demoPlace: '데모',
  realPlace: '장소',
  noDetails: '상세 정보 없음',
  fastestRoute: '가장 빠른 경로',
  suggestedRoute: '추천 경로',
  segmentGuide: '버스 구간을 누르면 승차·하차 정류장을 지도에서 확인할 수 있습니다.',
  stopFocusLoading: '버스 승차·하차 정류장을 찾는 중입니다.',
  stopFocusReady: '버스 승차·하차 정류장을 지도에 표시했습니다.',
  stopFocusError: '버스 정류장 위치를 찾지 못했습니다. 경로 정보만 확인해 주세요.',
  stopFocusSummary: (segment) => `${segment.name} 승차·하차 정류장 표시 중`,
  waitLabel: '대기',
  realtimeApplied: '실시간 반영',
  realtimeFallback: '기본 경로',
  tightConnection: '놓칠 수 있음',
};

const state = {
  meta: {
    demoMode: false,
  },
  fields: {
    origin: {
      query: '',
      place: null,
      suggestions: [],
      status: 'idle',
      activeIndex: 0,
      helperText: COPY.originIdle,
    },
    destination: {
      query: '',
      place: null,
      suggestions: [],
      status: 'idle',
      activeIndex: 0,
      helperText: COPY.destIdle,
    },
  },
  savedPlaces: [],
  sortBy: 'time',
  departureTime: null,
  routes: [],
  selectedRouteId: null,
  selectedSegmentId: null,
  map: null,
  searchMessage: COPY.readyToSearch,
};

const dom = {};
const debouncedSearch = debounce((fieldName) => performPlaceSearch(fieldName), 250);

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheDom();
  bindEvents();
  renderClock();
  window.setInterval(renderClock, 30000);

  dom.timeInput.value = toLocalDateTimeValue(new Date());
  state.savedPlaces = loadSavedPlaces();

  try {
    state.meta = await getAppMeta();
  } catch {
    state.searchMessage = COPY.apiOffline;
  }

  updateServiceStatus();
  renderField('origin');
  renderField('destination');
  renderSearchState();
  state.map = await createTransitMap(dom.map);
  syncMap();
}

function cacheDom() {
  dom.currentTime = $('#currentTime');
  dom.serviceStatus = $('#serviceStatus');
  dom.originInput = $('#originInput');
  dom.destInput = $('#destInput');
  dom.originHint = $('#originHint');
  dom.destHint = $('#destHint');
  dom.originBadge = $('#originBadge');
  dom.destBadge = $('#destBadge');
  dom.originAutocomplete = $('#originAutocomplete');
  dom.destAutocomplete = $('#destAutocomplete');
  dom.btnOriginClear = $('#btnOriginClear');
  dom.btnDestClear = $('#btnDestClear');
  dom.btnUseGps = $('#btnUseGps');
  dom.btnOriginHome = $('#btnOriginHome');
  dom.btnOriginOffice = $('#btnOriginOffice');
  dom.btnDestHome = $('#btnDestHome');
  dom.btnDestOffice = $('#btnDestOffice');
  dom.btnSwap = $('#btnSwap');
  dom.btnSaveHome = $('#btnSaveHome');
  dom.btnSaveOffice = $('#btnSaveOffice');
  dom.btnNow = $('#btnNow');
  dom.timeInput = $('#timeInput');
  dom.btnSearch = $('#btnSearch');
  dom.searchMessage = $('#searchMessage');
  dom.resultsList = $('#resultsList');
  dom.emptyState = $('#emptyState');
  dom.map = $('#map');
  dom.mapSummary = $('#mapSummary');
}

function bindEvents() {
  dom.originInput.addEventListener('input', handleFieldInput('origin'));
  dom.destInput.addEventListener('input', handleFieldInput('destination'));
  dom.originInput.addEventListener('focus', () => maybeOpenSuggestions('origin'));
  dom.destInput.addEventListener('focus', () => maybeOpenSuggestions('destination'));
  dom.originInput.addEventListener('keydown', handleAutocompleteKeydown('origin'));
  dom.destInput.addEventListener('keydown', handleAutocompleteKeydown('destination'));

  dom.btnOriginClear.addEventListener('click', () => clearField('origin'));
  dom.btnDestClear.addEventListener('click', () => clearField('destination'));
  dom.btnUseGps.addEventListener('click', loadCurrentLocation);
  dom.btnOriginHome.addEventListener('click', () => applySavedPlace('origin', 'home'));
  dom.btnOriginOffice.addEventListener('click', () => applySavedPlace('origin', 'office'));
  dom.btnDestHome.addEventListener('click', () => applySavedPlace('destination', 'home'));
  dom.btnDestOffice.addEventListener('click', () => applySavedPlace('destination', 'office'));
  dom.btnSwap.addEventListener('click', swapPlaces);
  dom.btnSaveHome.addEventListener('click', () => saveCurrentDestination('home'));
  dom.btnSaveOffice.addEventListener('click', () => saveCurrentDestination('office'));
  dom.btnNow.addEventListener('click', () => {
    state.departureTime = null;
    dom.btnNow.classList.add('active');
    dom.timeInput.value = toLocalDateTimeValue(new Date());
  });
  dom.timeInput.addEventListener('change', () => {
    state.departureTime = dom.timeInput.value ? new Date(dom.timeInput.value).toISOString() : null;
    dom.btnNow.classList.remove('active');
  });
  dom.btnSearch.addEventListener('click', handleSearch);

  document.querySelectorAll('.sort-button').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.sort-button').forEach((node) => node.classList.remove('active'));
      button.classList.add('active');
      state.sortBy = button.dataset.sort;
      renderRoutes();
    });
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.field-block')) {
      closeSuggestions('origin');
      closeSuggestions('destination');
    }
  });
}

function renderClock() {
  dom.currentTime.textContent = formatDateTime(new Date());
}

function updateServiceStatus() {
  const isLive = !state.meta.demoMode && hasTransitApiKey();
  dom.serviceStatus.textContent = isLive ? COPY.liveMode : COPY.demoMode;
  dom.serviceStatus.classList.toggle('demo', !isLive);
}

async function loadCurrentLocation() {
  setFieldStatus('origin', 'loading', COPY.gpsLoading);
  const position = await getCurrentPosition();

  if (position.isFallback) {
    try {
      const { place } = await reverseGeocode(position.coords.lat, position.coords.lng);
      selectPlace('origin', {
        ...place,
        name: COPY.fallbackOrigin,
        lat: position.coords.lat,
        lng: position.coords.lng,
      });
      state.fields.origin.helperText = COPY.fallbackOriginHint;
      state.searchMessage = COPY.fallbackOriginHint;
    } catch {
      selectPlace('origin', {
        id: 'default-origin',
        name: COPY.fallbackOrigin,
        roadAddress: '',
        jibunAddress: '',
        lat: position.coords.lat,
        lng: position.coords.lng,
        source: 'fallback',
      });
      state.fields.origin.helperText = COPY.fallbackOriginHint;
      state.searchMessage = COPY.gpsDenied;
    }
    renderField('origin');
    renderSearchState();
    syncMap();
    return;
  }

  try {
    const { place } = await reverseGeocode(position.coords.lat, position.coords.lng);
    selectPlace('origin', {
      ...place,
      name: place.name || COPY.currentOrigin,
      lat: position.coords.lat,
      lng: position.coords.lng,
    });
    state.fields.origin.helperText = place.roadAddress || place.jibunAddress || COPY.originSelected;
    state.searchMessage = COPY.originSelected;
  } catch {
    selectPlace('origin', {
      id: 'current-origin',
      name: COPY.currentOrigin,
      roadAddress: '',
      jibunAddress: '',
      lat: position.coords.lat,
      lng: position.coords.lng,
      source: 'gps',
    });
    state.fields.origin.helperText = `현재 좌표(${position.coords.lat.toFixed(4)}, ${position.coords.lng.toFixed(4)})를 출발지로 설정했습니다.`;
    state.searchMessage = COPY.originSelected;
  }

  renderField('origin');
  renderSearchState();
  syncMap();
}

function handleFieldInput(fieldName) {
  return (event) => {
    const field = state.fields[fieldName];
    field.query = event.target.value;

    if (field.place && field.place.name !== field.query) {
      field.place = null;
      field.helperText = fieldName === 'origin' ? COPY.originReselect : COPY.destReselect;
      if (fieldName === 'destination') {
        clearRouteResults();
      }
    }

    if (!field.query.trim()) {
      field.suggestions = [];
      field.status = 'idle';
      field.helperText = fieldName === 'origin' ? COPY.originIdle : COPY.destIdle;
      if (fieldName === 'destination') {
        clearRouteResults();
      }
      renderField(fieldName);
      renderSearchState();
      syncMap();
      return;
    }

    field.status = 'typing';
    field.activeIndex = 0;
    renderField(fieldName);
    renderSearchState();
    debouncedSearch(fieldName);
  };
}

async function performPlaceSearch(fieldName) {
  const field = state.fields[fieldName];
  const query = field.query.trim();

  if (!query) {
    return;
  }

  field.status = 'loading';
  field.helperText = COPY.loadingPlaces;
  renderField(fieldName);

  try {
    const { places, meta } = await searchPlaces(query);
    state.meta = { ...state.meta, ...meta };
    updateServiceStatus();
    field.suggestions = places;
    field.activeIndex = 0;
    field.status = places.length ? 'suggesting' : 'empty';
    field.helperText = places.length ? COPY.selectFromList : COPY.noPlaces;
  } catch (error) {
    field.suggestions = [];
    field.status = 'error';
    field.helperText = error instanceof Error ? error.message : COPY.placeSearchError;
  }

  renderField(fieldName);
  renderSearchState();
}

function maybeOpenSuggestions(fieldName) {
  const field = state.fields[fieldName];
  if (field.suggestions.length > 0 && !field.place) {
    field.status = 'suggesting';
    renderField(fieldName);
  }
}

function handleAutocompleteKeydown(fieldName) {
  return (event) => {
    const field = state.fields[fieldName];
    if (!field.suggestions.length) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      field.activeIndex = (field.activeIndex + 1) % field.suggestions.length;
      renderField(fieldName);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      field.activeIndex = (field.activeIndex - 1 + field.suggestions.length) % field.suggestions.length;
      renderField(fieldName);
      return;
    }

    if (event.key === 'Escape') {
      closeSuggestions(fieldName);
      return;
    }

    if (event.key === 'Enter' && !field.place && field.status === 'suggesting') {
      event.preventDefault();
      field.helperText = COPY.enterHint;
      renderField(fieldName);
    }
  };
}

function closeSuggestions(fieldName) {
  const field = state.fields[fieldName];
  if (['suggesting', 'loading', 'empty', 'error'].includes(field.status)) {
    field.status = field.place ? 'selected' : 'idle';
    renderField(fieldName);
  }
}

function renderField(fieldName) {
  const field = state.fields[fieldName];
  const input = fieldName === 'origin' ? dom.originInput : dom.destInput;
  const hint = fieldName === 'origin' ? dom.originHint : dom.destHint;
  const badge = fieldName === 'origin' ? dom.originBadge : dom.destBadge;
  const autocomplete = fieldName === 'origin' ? dom.originAutocomplete : dom.destAutocomplete;
  const clearButton = fieldName === 'origin' ? dom.btnOriginClear : dom.btnDestClear;
  const fieldBlock = input.closest('.field-block');

  input.value = field.query;
  hint.textContent = field.helperText;
  badge.textContent = field.place ? COPY.confirmed : field.status === 'loading' ? COPY.searching : COPY.notConfirmed;
  badge.classList.toggle('confirmed', Boolean(field.place));
  clearButton.hidden = !field.query;

  autocomplete.innerHTML = buildAutocomplete(fieldName);
  autocomplete.classList.toggle('open', ['suggesting', 'loading', 'empty', 'error'].includes(field.status) && !field.place && !!field.query);
  fieldBlock?.classList.toggle('dropdown-open', autocomplete.classList.contains('open'));

  autocomplete.querySelectorAll('[data-index]').forEach((node) => {
    node.addEventListener('mouseenter', () => {
      field.activeIndex = Number(node.dataset.index);
      renderField(fieldName);
    });
    node.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const place = field.suggestions[Number(node.dataset.index)];
      selectPlace(fieldName, place);
    });
    node.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const place = field.suggestions[Number(node.dataset.index)];
      selectPlace(fieldName, place);
    });
  });
}

function buildAutocomplete(fieldName) {
  const field = state.fields[fieldName];

  if (field.status === 'loading') {
    return '<li class="autocomplete-state">검색 중입니다...</li>';
  }
  if (field.status === 'error') {
    return `<li class="autocomplete-state error">${field.helperText}</li>`;
  }
  if (field.status === 'empty') {
    return '<li class="autocomplete-state">검색 결과가 없습니다.</li>';
  }

  return field.suggestions.map((place, index) => `
    <li class="autocomplete-item ${index === field.activeIndex ? 'active' : ''}" data-index="${index}" role="option" aria-selected="${index === field.activeIndex}">
      <div>
        <strong>${highlightMatch(place.name, field.query)}</strong>
        <p>${place.roadAddress || place.jibunAddress || COPY.noAddress}</p>
      </div>
      <span>${place.source === 'mock' ? COPY.demoPlace : COPY.realPlace}</span>
    </li>
  `).join('');
}

function selectPlace(fieldName, place) {
  const field = state.fields[fieldName];
  field.place = place;
  field.query = place.name;
  field.suggestions = [];
  field.status = 'selected';
  field.activeIndex = 0;
  field.helperText = place.roadAddress || place.jibunAddress || `${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}`;

  if (fieldName === 'destination') {
    clearRouteResults();
  }

  renderField(fieldName);
  renderSearchState();
  syncMap();
}

function clearField(fieldName) {
  const field = state.fields[fieldName];
  field.query = '';
  field.place = null;
  field.suggestions = [];
  field.status = 'idle';
  field.activeIndex = 0;
  field.helperText = fieldName === 'origin' ? COPY.originIdle : COPY.destIdle;

  if (fieldName === 'destination') {
    clearRouteResults();
  }

  renderField(fieldName);
  renderSearchState();
  syncMap();
}

function swapPlaces() {
  const origin = clonePlace(state.fields.origin.place);
  const destination = clonePlace(state.fields.destination.place);

  if (!origin || !destination) {
    state.searchMessage = COPY.swapWarning;
    renderSearchState();
    return;
  }

  selectPlace('origin', destination);
  selectPlace('destination', origin);
  state.searchMessage = COPY.swapped;
  renderSearchState();
}

function clonePlace(place) {
  return place ? JSON.parse(JSON.stringify(place)) : null;
}

function getSavedPlace(label) {
  return state.savedPlaces.find((item) => item.label === label)?.place || null;
}

function applySavedPlace(fieldName, label) {
  state.savedPlaces = loadSavedPlaces();
  const place = getSavedPlace(label);

  if (!place) {
    state.searchMessage = COPY.noSavedPlace;
    renderSearchState();
    return;
  }

  selectPlace(fieldName, place);
  state.searchMessage = fieldName === 'origin'
    ? (label === 'home' ? COPY.loadedOriginHome : COPY.loadedOriginOffice)
    : (label === 'home' ? COPY.loadedDestHome : COPY.loadedDestOffice);
  renderSearchState();
}

function saveCurrentDestination(label) {
  const destination = state.fields.destination.place;
  if (!destination) {
    state.searchMessage = COPY.saveFirst;
    renderSearchState();
    return;
  }

  state.savedPlaces = saveSavedPlace(label, destination);
  state.searchMessage = label === 'home' ? COPY.savedHome : COPY.savedOffice;
  renderSearchState();
}

function renderSearchState() {
  const originNeedsConfirm = Boolean(state.fields.origin.query && !state.fields.origin.place);
  const destinationNeedsConfirm = Boolean(state.fields.destination.query && !state.fields.destination.place);
  const canSearch = Boolean(state.fields.origin.place && state.fields.destination.place);

  dom.btnSearch.disabled = !canSearch;

  if (!hasTransitApiKey()) {
    dom.searchMessage.textContent = COPY.transitKeyMissing;
    return;
  }

  if (originNeedsConfirm) {
    dom.searchMessage.textContent = COPY.mustConfirmOrigin;
    return;
  }

  if (destinationNeedsConfirm) {
    dom.searchMessage.textContent = COPY.mustConfirmDestination;
    return;
  }

  dom.searchMessage.textContent = state.searchMessage;
}

async function handleSearch() {
  if (!hasTransitApiKey()) {
    state.searchMessage = COPY.transitKeyMissing;
    renderSearchState();
    return;
  }

  if (!state.fields.origin.place || !state.fields.destination.place) {
    state.searchMessage = COPY.needBothPlaces;
    renderSearchState();
    return;
  }

  state.searchMessage = COPY.searchingRoutes;
  state.selectedSegmentId = null;
  dom.btnSearch.disabled = true;
  dom.btnSearch.classList.add('loading');
  renderSearchState();
  dom.emptyState.hidden = true;
  dom.resultsList.innerHTML = `<div class="loading-card glass">${COPY.loadingRoutes}</div>`;

  try {
    const { routes, meta } = await searchTransitRoutes(
      state.fields.origin.place,
      state.fields.destination.place,
      state.departureTime || new Date().toISOString(),
    );

    state.searchMessage = COPY.etaLoading;
    renderSearchState();

    const scoredRoutes = await enrichRoutesWithRealtime(routes);
    state.meta = { ...state.meta, ...meta };
    state.routes = scoredRoutes;
    const defaultRoute = sortRoutes(scoredRoutes, state.sortBy)[0] || scoredRoutes[0] || null;
    state.selectedRouteId = defaultRoute?.id ?? null;
    state.selectedSegmentId = null;
    state.searchMessage = scoredRoutes.length ? COPY.foundRoutes(scoredRoutes.length) : COPY.noRoutes;
    updateServiceStatus();
  } catch (error) {
    clearRouteResults();
    state.searchMessage = error instanceof Error ? error.message : COPY.searchFailed;
  } finally {
    dom.btnSearch.classList.remove('loading');
    renderSearchState();
    renderRoutes();
    syncMap();
  }
}

function clearRouteResults() {
  state.routes = [];
  state.selectedRouteId = null;
  state.selectedSegmentId = null;
  if (state.map) {
    state.map.clearSegmentFocus();
  }
}

function renderRealtimeMeta(route) {
  if (!route.realtime) {
    return `<span>${COPY.realtimeFallback}</span>`;
  }

  if (route.realtime.status === 'live' || route.realtime.status === 'tight') {
    const warning = route.realtime.status === 'tight' ? ` · ${COPY.tightConnection}` : '';
    const leftStation = Number.isFinite(route.realtime.leftStation) ? ` · ${route.realtime.leftStation}정류장 전` : '';
    return `<span>${COPY.waitLabel} ${formatMinutesLabel(route.realtime.waitMinutes)}</span><span>${COPY.realtimeApplied}${leftStation}${warning}</span>`;
  }

  return `<span>${COPY.realtimeFallback}</span>`;
}

function renderRoutes() {
  if (!state.routes.length) {
    dom.resultsList.innerHTML = '';
    dom.emptyState.hidden = false;
    dom.mapSummary.textContent = COPY.noRouteYet;
    return;
  }

  dom.emptyState.hidden = true;
  const sorted = sortRoutes(state.routes, state.sortBy);
  const fastestId = sortRoutes(state.routes, 'time')[0]?.id;
  const selectedRoute = getSelectedRoute(sorted);
  const activeSegment = getSelectedSegment(selectedRoute);

  dom.resultsList.innerHTML = sorted.map((route) => `
    <article class="route-card glass ${route.id === state.selectedRouteId ? 'selected' : ''}" data-route-id="${route.id}">
      <div class="route-top">
        <div>
          <p class="route-kicker">${route.id === fastestId ? COPY.fastestRoute : COPY.suggestedRoute}</p>
          <h3>${formatDuration(getRouteSortTime(route))}</h3>
          ${route.effectiveTotalTime !== route.totalTime ? `<p class="route-base-time">기본 ${formatDuration(route.totalTime)}</p>` : ''}
        </div>
        <div class="route-side">
          <span>환승 ${route.transferCount}회</span>
          <span>도보 ${formatMinutesLabel(route.walkTime)}</span>
          ${renderRealtimeMeta(route)}
          <strong>${formatFare(route.fare)}</strong>
        </div>
      </div>
      <div class="segment-row">
        ${route.segments.map((segment) => `
          <button class="segment-pill ${segment.type} ${segment.id === state.selectedSegmentId ? 'active' : ''}" type="button" data-route-id="${route.id}" data-segment-id="${segment.id}">
            <strong>${TRANSPORT_ICONS[segment.type]}</strong>
            <span>${segment.name}</span>
            <em>${formatMinutesLabel(segment.duration)}</em>
          </button>
        `).join('')}
      </div>
      <div class="route-footer">
        <span>${formatTime(route.departureTime)} 출발</span>
        <span>${formatTime(route.effectiveArrivalTime || route.arrivalTime)} 도착</span>
      </div>
      <div class="route-details">
        ${route.segments.map((segment) => `
          <div class="detail-row ${segment.id === state.selectedSegmentId ? 'active' : ''}" data-route-id="${route.id}" data-segment-id="${segment.id}">
            <div>
              <strong>${segment.name}</strong>
              <p>${segment.detail || COPY.noDetails}</p>
            </div>
            <span>${formatMinutesLabel(segment.duration)}</span>
          </div>
        `).join('')}
      </div>
      ${route.id === state.selectedRouteId ? `<p class="segment-helper">${COPY.segmentGuide}</p>` : ''}
    </article>
  `).join('');

  dom.resultsList.querySelectorAll('.route-card').forEach((card) => {
    card.addEventListener('click', () => {
      const routeId = Number(card.dataset.routeId);
      state.selectedRouteId = routeId;
      state.selectedSegmentId = null;
      if (state.map) {
        state.map.clearSegmentFocus();
      }
      renderRoutes();
      syncMap();
    });
  });

  dom.resultsList.querySelectorAll('[data-segment-id]').forEach((node) => {
    node.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const routeId = Number(node.dataset.routeId);
      const segmentId = node.dataset.segmentId;
      await focusSegment(routeId, segmentId);
    });
  });

  dom.mapSummary.textContent = activeSegment?.type === 'bus'
    ? COPY.stopFocusSummary(activeSegment)
    : `${formatDuration(getRouteSortTime(selectedRoute))} · 환승 ${selectedRoute.transferCount}회 · 도보 ${formatMinutesLabel(selectedRoute.walkTime)}`;
}

async function focusSegment(routeId, segmentId) {
  state.selectedRouteId = routeId;
  state.selectedSegmentId = segmentId;
  renderRoutes();
  syncMap();

  const route = state.routes.find((item) => item.id === routeId);
  const segment = route?.segments.find((item) => item.id === segmentId);

  if (!segment || segment.type !== 'bus') {
    state.searchMessage = COPY.readyToSearch;
    renderSearchState();
    return;
  }

  state.searchMessage = COPY.stopFocusLoading;
  renderSearchState();

  try {
    const resolved = await resolveBusSegmentStops(segment);
    segment.startStop = resolved.startStop;
    segment.endStop = resolved.endStop;

    if (!segment.startStop || !segment.endStop) {
      throw new Error(COPY.stopFocusError);
    }

    state.map.setSegmentFocus(segment, `${segment.startStop.name} -> ${segment.endStop.name}`);
    state.searchMessage = COPY.stopFocusReady;
  } catch (error) {
    state.map.clearSegmentFocus();
    state.searchMessage = error instanceof Error ? error.message : COPY.stopFocusError;
  }

  renderSearchState();
  renderRoutes();
}

function getSelectedRoute(sortedRoutes = state.routes) {
  return sortedRoutes.find((route) => route.id === state.selectedRouteId) || sortedRoutes[0] || null;
}

function getSelectedSegment(route) {
  return route?.segments.find((segment) => segment.id === state.selectedSegmentId) || null;
}

function syncMap() {
  if (!state.map) {
    return;
  }

  const selectedRoute = getSelectedRoute();
  const selectedSegment = getSelectedSegment(selectedRoute);

  state.map.setPlaces(state.fields.origin.place, state.fields.destination.place);

  if (selectedSegment?.type === 'bus' && selectedSegment.startStop && selectedSegment.endStop) {
    state.map.setSegmentFocus(selectedSegment, `${selectedSegment.startStop.name} -> ${selectedSegment.endStop.name}`);
    dom.mapSummary.textContent = COPY.stopFocusSummary(selectedSegment);
    return;
  }

  state.map.clearSegmentFocus();
  state.map.setRouteSummary(
    selectedRoute && state.fields.destination.place
      ? {
          title: `예상 ${formatDuration(getRouteSortTime(selectedRoute))}`,
          description: `${formatTime(selectedRoute.departureTime)} 출발 · ${formatTime(selectedRoute.effectiveArrivalTime || selectedRoute.arrivalTime)} 도착`,
        }
      : null,
    state.fields.destination.place,
  );

  dom.mapSummary.textContent = selectedRoute
    ? `${formatDuration(getRouteSortTime(selectedRoute))} · 환승 ${selectedRoute.transferCount}회 · 도보 ${formatMinutesLabel(selectedRoute.walkTime)}`
    : COPY.noRouteYet;
}

function setFieldStatus(fieldName, status, helperText) {
  const field = state.fields[fieldName];
  field.status = status;
  field.helperText = helperText;
  renderField(fieldName);
}
