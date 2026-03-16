import './style.css';
import { getAppMeta, hasTransitApiKey, reverseGeocode, searchPlaces, searchTransitRoutes } from './api.js';
import { getCurrentPosition } from './geo.js';
import { createTransitMap } from './map.js';
import { loadSavedPlaces, saveSavedPlace } from './storage.js';
import {
  TRANSPORT_ICONS,
  debounce,
  formatDateTime,
  formatDuration,
  formatFare,
  formatTime,
  highlightMatch,
  sortRoutes,
  toLocalDateTimeValue,
} from './utils.js';

const $ = (selector) => document.querySelector(selector);

const COPY = {
  originLoading: '출발지를 불러오는 중입니다.',
  destIdle: '도착지를 입력하면 추천 장소가 나타납니다.',
  readyToSearch: '출발지와 도착지를 모두 확정하면 경로를 찾을 수 있습니다.',
  apiOffline: '장소 검색 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  liveMode: '실시간 API 연결',
  demoMode: '데모 모드',
  gpsLoading: '현재 위치를 확인하는 중입니다.',
  fallbackOrigin: '서울시청',
  currentOrigin: '현재 위치',
  fallbackOriginHint: '위치 권한이 없어 서울시청을 기본 출발지로 사용합니다.',
  originSelected: '현재 위치를 출발지로 설정했습니다.',
  originReselect: '출발지를 다시 선택해 주세요.',
  destReselect: '도착지를 자동완성 목록에서 다시 선택해 주세요.',
  loadingPlaces: '장소 후보를 불러오는 중입니다.',
  selectFromList: '목록에서 원하는 장소를 선택해 확정해 주세요.',
  noPlaces: '검색 결과가 없습니다. 다른 키워드로 다시 시도해 주세요.',
  placeSearchError: '장소 검색 중 오류가 발생했습니다.',
  enterHint: 'Enter 대신 목록에서 장소를 선택해 주세요.',
  originEmpty: '현재 위치를 불러오거나 출발지를 입력해 주세요.',
  destEmpty: '도착지를 자동완성 목록에서 선택해 주세요.',
  swapWarning: '출발지와 도착지가 모두 확정되어야 서로 바꿀 수 있습니다.',
  swapped: '출발지와 도착지를 서로 바꿨습니다.',
  saveFirst: '먼저 도착지를 선택한 뒤 저장해 주세요.',
  savedHome: '현재 도착지를 집으로 저장했습니다.',
  savedOffice: '현재 도착지를 회사로 저장했습니다.',
  loadedHome: '저장된 집을 도착지로 불러왔습니다.',
  loadedOffice: '저장된 회사를 도착지로 불러왔습니다.',
  mustConfirmDestination: '도착지는 자동완성 목록에서 선택해야 확정됩니다.',
  needBothPlaces: '출발지와 도착지를 모두 확정해 주세요.',
  transitKeyMissing: 'ODSAY 키가 설정되지 않았습니다. VITE_ODSAY_API_KEY를 확인해 주세요.',
  searchingRoutes: '대중교통 경로를 계산하는 중입니다.',
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
      helperText: COPY.originLoading,
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
  renderSavedPlaces();

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
  await loadCurrentLocation();
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
  dom.btnSwap = $('#btnSwap');
  dom.btnSaveHome = $('#btnSaveHome');
  dom.btnSaveOffice = $('#btnSaveOffice');
  dom.btnNow = $('#btnNow');
  dom.timeInput = $('#timeInput');
  dom.btnSearch = $('#btnSearch');
  dom.searchMessage = $('#searchMessage');
  dom.savedPlaces = $('#savedPlaces');
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

  try {
    const { place } = await reverseGeocode(position.coords.lat, position.coords.lng);
    selectPlace('origin', {
      ...place,
      name: position.isFallback ? COPY.fallbackOrigin : place.name || COPY.currentOrigin,
      lat: position.coords.lat,
      lng: position.coords.lng,
    });
    state.fields.origin.helperText = position.isFallback
      ? COPY.fallbackOriginHint
      : place.roadAddress || place.jibunAddress || COPY.originSelected;
  } catch {
    selectPlace('origin', {
      id: 'default-origin',
      name: position.isFallback ? COPY.fallbackOrigin : COPY.currentOrigin,
      roadAddress: '',
      jibunAddress: '',
      lat: position.coords.lat,
      lng: position.coords.lng,
      source: 'fallback',
    });
    state.fields.origin.helperText = position.isFallback
      ? COPY.fallbackOriginHint
      : `현재 좌표(${position.coords.lat.toFixed(4)}, ${position.coords.lng.toFixed(4)})를 출발지로 설정했습니다.`;
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
    }

    if (!field.query.trim()) {
      field.suggestions = [];
      field.status = 'idle';
      if (fieldName === 'destination') {
        state.routes = [];
        state.selectedRouteId = null;
      }
      renderField(fieldName);
      renderRoutes();
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
    state.routes = [];
    state.selectedRouteId = null;
  }

  renderField(fieldName);
  renderRoutes();
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
  field.helperText = fieldName === 'origin' ? COPY.originEmpty : COPY.destEmpty;

  if (fieldName === 'destination') {
    state.routes = [];
    state.selectedRouteId = null;
  }

  renderField(fieldName);
  renderRoutes();
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

function saveCurrentDestination(label) {
  const destination = state.fields.destination.place;
  if (!destination) {
    state.searchMessage = COPY.saveFirst;
    renderSearchState();
    return;
  }

  state.savedPlaces = saveSavedPlace(label, destination);
  renderSavedPlaces();
  state.searchMessage = label === 'home' ? COPY.savedHome : COPY.savedOffice;
  renderSearchState();
}

function renderSavedPlaces() {
  if (!state.savedPlaces.length) {
    dom.savedPlaces.innerHTML = '';
    return;
  }

  dom.savedPlaces.innerHTML = state.savedPlaces
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((item) => `
      <button class="saved-chip" type="button" data-label="${item.label}">
        <span>${item.label === 'home' ? '집' : '회사'}</span>
        <strong>${item.place.name}</strong>
      </button>
    `)
    .join('');

  dom.savedPlaces.querySelectorAll('.saved-chip').forEach((button) => {
    button.addEventListener('click', () => {
      const item = state.savedPlaces.find((saved) => saved.label === button.dataset.label);
      if (item) {
        selectPlace('destination', item.place);
        state.searchMessage = button.dataset.label === 'home' ? COPY.loadedHome : COPY.loadedOffice;
        renderSearchState();
      }
    });
  });
}

function renderSearchState() {
  const canSearch = Boolean(state.fields.origin.place && state.fields.destination.place);
  dom.btnSearch.disabled = !canSearch;
  dom.searchMessage.textContent = state.searchMessage;

  if (!hasTransitApiKey()) {
    dom.searchMessage.textContent = COPY.transitKeyMissing;
    return;
  }

  if (!state.fields.destination.place && state.fields.destination.query && state.fields.destination.status !== 'selected') {
    dom.searchMessage.textContent = COPY.mustConfirmDestination;
  }
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

    state.meta = { ...state.meta, ...meta };
    state.routes = routes;
    state.selectedRouteId = routes[0]?.id ?? null;
    state.searchMessage = routes.length ? COPY.foundRoutes(routes.length) : COPY.noRoutes;
    updateServiceStatus();
  } catch (error) {
    state.routes = [];
    state.selectedRouteId = null;
    state.searchMessage = error instanceof Error ? error.message : COPY.searchFailed;
  } finally {
    dom.btnSearch.classList.remove('loading');
    renderSearchState();
    renderRoutes();
    syncMap();
  }
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
  if (!state.selectedRouteId) {
    state.selectedRouteId = sorted[0]?.id ?? null;
  }

  const fastestId = sortRoutes(state.routes, 'time')[0]?.id;

  dom.resultsList.innerHTML = sorted.map((route) => `
    <article class="route-card glass ${route.id === state.selectedRouteId ? 'selected' : ''}">
      <div class="route-top">
        <div>
          <p class="route-kicker">${route.id === fastestId ? COPY.fastestRoute : COPY.suggestedRoute}</p>
          <h3>${formatDuration(route.totalTime)}</h3>
        </div>
        <div class="route-side">
          <span>환승 ${route.transferCount}회</span>
          <span>도보 ${route.walkTime}분</span>
          <strong>${formatFare(route.fare)}</strong>
        </div>
      </div>
      <div class="segment-row">
        ${route.segments.map((segment) => `
          <span class="segment-pill ${segment.type}">
            <strong>${TRANSPORT_ICONS[segment.type]}</strong>
            <span>${segment.name}</span>
            <em>${segment.duration}분</em>
          </span>
        `).join('')}
      </div>
      <div class="route-footer">
        <span>${formatTime(route.departureTime)} 출발</span>
        <span>${formatTime(route.arrivalTime)} 도착</span>
      </div>
      <div class="route-details">
        ${route.segments.map((segment) => `
          <div class="detail-row">
            <div>
              <strong>${segment.name}</strong>
              <p>${segment.detail || COPY.noDetails}</p>
            </div>
            <span>${segment.duration}분</span>
          </div>
        `).join('')}
      </div>
    </article>
  `).join('');

  dom.resultsList.querySelectorAll('.route-card').forEach((card, index) => {
    card.addEventListener('click', () => {
      state.selectedRouteId = sorted[index].id;
      renderRoutes();
      syncMap();
    });
  });

  const selected = getSelectedRoute();
  dom.mapSummary.textContent = selected
    ? `${formatDuration(selected.totalTime)} · 환승 ${selected.transferCount}회 · 도보 ${selected.walkTime}분`
    : COPY.noRouteYet;
}

function getSelectedRoute() {
  return state.routes.find((route) => route.id === state.selectedRouteId) || null;
}

function syncMap() {
  if (!state.map) {
    return;
  }

  state.map.setPlaces(state.fields.origin.place, state.fields.destination.place);
  const selected = getSelectedRoute();
  state.map.setRouteSummary(
    selected
      ? {
          title: `예상 ${formatDuration(selected.totalTime)}`,
          description: `${formatTime(selected.departureTime)} 출발 · ${formatTime(selected.arrivalTime)} 도착`,
        }
      : null,
    state.fields.destination.place,
  );
}

function setFieldStatus(fieldName, status, helperText) {
  const field = state.fields[fieldName];
  field.status = status;
  field.helperText = helperText;
  renderField(fieldName);
}
