const ODSAY_API_KEY = import.meta.env.VITE_ODSAY_API_KEY || '';
const STATIC_WAIT_BASELINE_MINUTES = 4;
const MINIMUM_BOARDING_BUFFER_MINUTES = 2;
const MISS_RISK_PENALTY_MINUTES = 7;

function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + minutes * 60000);
}

function getBusTypeLabel(type) {
  const map = {
    1: '일반',
    2: '좌석',
    3: '마을',
    4: '직행',
    5: '공항',
    6: '간선',
    10: '외곽',
    11: '간선',
    12: '지선',
    13: '순환',
    14: '광역',
    15: '마을',
  };
  return map[type] || '버스';
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || '요청을 처리하지 못했습니다.');
  }

  return payload;
}

function buildOdsayUrl(origin, destination) {
  const url = new URL('https://api.odsay.com/v1/api/searchPubTransPathT');
  url.searchParams.set('SX', String(origin.lng));
  url.searchParams.set('SY', String(origin.lat));
  url.searchParams.set('EX', String(destination.lng));
  url.searchParams.set('EY', String(destination.lat));
  url.searchParams.set('apiKey', ODSAY_API_KEY);
  return url;
}

function buildRealtimeUrl(stationId, routeId = '') {
  const url = new URL('https://api.odsay.com/v1/api/realtimeStation');
  url.searchParams.set('stationID', String(stationId));
  if (routeId) {
    url.searchParams.set('routeIDs', String(routeId));
  }
  url.searchParams.set('apiKey', ODSAY_API_KEY);
  return url;
}

function buildBusStationInfoUrl(stationId) {
  const url = new URL('https://api.odsay.com/v1/api/busStationInfo');
  url.searchParams.set('stationID', String(stationId));
  url.searchParams.set('apiKey', ODSAY_API_KEY);
  return url;
}

function buildBusRealtimeProxyUrl(stop, routeId, routeName) {
  const params = new URLSearchParams();

  if (stop?.stationId) {
    params.set('stationId', String(stop.stationId));
  }
  if (stop?.localStationId) {
    params.set('localStationId', String(stop.localStationId));
  }
  if (stop?.arsId) {
    params.set('arsId', String(stop.arsId));
  }
  if (routeId) {
    params.set('routeId', String(routeId));
  }
  if (routeName) {
    params.set('routeName', String(routeName));
  }

  return `/api/bus/realtime?${params.toString()}`;
}

function extractStops(subPath) {
  return subPath.passStopList?.stations?.map((station) => ({
    name: station.stationName,
    lat: station.y ? Number(station.y) : null,
    lng: station.x ? Number(station.x) : null,
    stationId: station.stationID || station.stationId || station.localStationID || null,
    localStationId: station.localStationID || station.localStationId || null,
    arsId: station.arsID || station.arsId || null,
  })).filter((station) => station.name) || [];
}

function toStop(name, lat, lng, stationId = null, options = {}) {
  if (!name) {
    return null;
  }

  const normalizedLat = Number(lat);
  const normalizedLng = Number(lng);
  return {
    name,
    lat: Number.isFinite(normalizedLat) ? normalizedLat : null,
    lng: Number.isFinite(normalizedLng) ? normalizedLng : null,
    stationId: stationId || null,
    localStationId: options.localStationId || null,
    arsId: options.arsId || null,
  };
}

function getBusRouteId(lane) {
  return lane.busID || lane.routeID || lane.routeId || lane.localBusID || lane.busLocalBlID || null;
}

function getStationId(subPath, type) {
  const candidates = type === 'start'
    ? [subPath.startID, subPath.startStationID, subPath.startStationId, subPath.startLocalStationID]
    : [subPath.endID, subPath.endStationID, subPath.endStationId, subPath.endLocalStationID];

  return candidates.find((value) => value !== undefined && value !== null && value !== '') || null;
}

function getLocalStationId(subPath, type) {
  const candidates = type === 'start'
    ? [subPath.startLocalStationID, subPath.startLocalStationId]
    : [subPath.endLocalStationID, subPath.endLocalStationId];

  return candidates.find((value) => value !== undefined && value !== null && value !== '') || null;
}

function getArsId(subPath, type) {
  const candidates = type === 'start'
    ? [subPath.startArsID, subPath.startArsId]
    : [subPath.endArsID, subPath.endArsId];

  return candidates.find((value) => value !== undefined && value !== null && value !== '') || null;
}

function buildStopQuery(stopName, routeName) {
  return `${stopName} ${routeName}`.trim();
}

function getFirstStop(stops) {
  return Array.isArray(stops) && stops.length ? stops[0] : null;
}

function getLastStop(stops) {
  return Array.isArray(stops) && stops.length ? stops[stops.length - 1] : null;
}

function buildRealtimeStopCandidates(startName, startStop, passStops) {
  const candidates = [];

  if (startStop) {
    candidates.push(startStop);
  }

  const matchingPassStops = (passStops || []).filter((stop) => {
    const stopName = String(stop?.name || '').trim();
    const targetName = String(startName || '').trim();
    return stopName && targetName && (stopName === targetName || stopName.includes(targetName) || targetName.includes(stopName));
  });

  candidates.push(...matchingPassStops);
  candidates.push(...(passStops || []).slice(0, 3));

  const seen = new Set();
  return candidates.filter((stop) => {
    const key = [stop?.stationId, stop?.localStationId, stop?.arsId, stop?.name].map((value) => String(value || '')).join('|');
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeRouteResponse(data, departureTime) {
  const baseTime = departureTime ? new Date(departureTime) : new Date();
  const paths = data.result?.path || [];

  return paths.map((pathItem, routeIndex) => {
    const info = pathItem.info || {};
    const segments = [];

    for (const subPath of pathItem.subPath || []) {
      if (!subPath.sectionTime) {
        continue;
      }

      if (subPath.trafficType === 3) {
        segments.push({
          id: `route-${routeIndex + 1}-walk-${segments.length + 1}`,
          type: 'walk',
          name: '도보',
          duration: subPath.sectionTime,
          detail: `${subPath.distance || 0}m 이동`,
          stops: extractStops(subPath),
          mapFocusType: 'none',
        });
        continue;
      }

      if (subPath.trafficType === 2) {
        const lane = subPath.lane?.[0] || {};
        const routeName = lane.busNo ? String(lane.busNo) : '버스';
        const passStops = extractStops(subPath);
        const firstPassStop = getFirstStop(passStops);
        const lastPassStop = getLastStop(passStops);
        const startStop = toStop(
          subPath.startName,
          subPath.startY,
          subPath.startX,
          getStationId(subPath, 'start') || firstPassStop?.stationId || null,
          {
            localStationId: getLocalStationId(subPath, 'start') || firstPassStop?.localStationId || null,
            arsId: getArsId(subPath, 'start') || firstPassStop?.arsId || null,
          },
        );
        const endStop = toStop(
          subPath.endName,
          subPath.endY,
          subPath.endX,
          getStationId(subPath, 'end') || lastPassStop?.stationId || null,
          {
            localStationId: getLocalStationId(subPath, 'end') || lastPassStop?.localStationId || null,
            arsId: getArsId(subPath, 'end') || lastPassStop?.arsId || null,
          },
        );

        segments.push({
          id: `route-${routeIndex + 1}-bus-${segments.length + 1}`,
          type: 'bus',
          name: routeName,
          duration: subPath.sectionTime,
          detail: `${subPath.startName} -> ${subPath.endName} · ${getBusTypeLabel(lane.type)}`,
          color: '#2563eb',
          routeId: getBusRouteId(lane),
          intervalMinutes: Number(lane.intervalTime ?? subPath.intervalTime) || null,
          startStop,
          endStop,
          realtimeStopCandidates: buildRealtimeStopCandidates(subPath.startName, startStop, passStops),
          stops: passStops,
          stopSearchHints: {
            start: buildStopQuery(subPath.startName, routeName),
            end: buildStopQuery(subPath.endName, routeName),
          },
          mapFocusType: 'bus-stops',
        });
        continue;
      }

      if (subPath.trafficType === 1) {
        const lane = subPath.lane?.[0] || {};
        segments.push({
          id: `route-${routeIndex + 1}-subway-${segments.length + 1}`,
          type: 'subway',
          name: lane.name || '지하철',
          duration: subPath.sectionTime,
          detail: `${subPath.startName} -> ${subPath.endName}`,
          color: lane.subwayColor ? `#${lane.subwayColor}` : undefined,
          stops: extractStops(subPath),
          startStop: toStop(subPath.startName, subPath.startY, subPath.startX, getStationId(subPath, 'start')),
          endStop: toStop(subPath.endName, subPath.endY, subPath.endX, getStationId(subPath, 'end')),
          mapFocusType: 'none',
        });
      }
    }

    const decoratedSegments = [];
    segments.forEach((segment, index) => {
      decoratedSegments.push(segment);
      const nextSegment = segments[index + 1];

      if (!nextSegment) {
        return;
      }

      if (segment.type !== 'walk' && nextSegment.type !== 'walk' && segment.type !== nextSegment.type) {
        decoratedSegments.push({
          id: `route-${routeIndex + 1}-transfer-${index + 1}`,
          type: 'transfer',
          name: '환승',
          duration: 3,
          detail: `${segment.name}에서 ${nextSegment.name}로 이동`,
          stops: [],
          mapFocusType: 'none',
        });
      }
    });

    const totalTime = info.totalTime || decoratedSegments.reduce((sum, segment) => sum + segment.duration, 0);

    return {
      id: routeIndex + 1,
      totalTime,
      effectiveTotalTime: totalTime,
      transferCount: Math.max(((info.busTransitCount || 0) + (info.subwayTransitCount || 0)) - 1, 0),
      walkTime: info.totalWalk
        ? Math.round(info.totalWalk / 60)
        : decoratedSegments.filter((segment) => segment.type === 'walk').reduce((sum, segment) => sum + segment.duration, 0),
      fare: info.payment || 0,
      departureTime: baseTime.toISOString(),
      arrivalTime: addMinutes(baseTime, totalTime).toISOString(),
      effectiveArrivalTime: addMinutes(baseTime, totalTime).toISOString(),
      realtime: null,
      realtimeBySegment: {},
      segments: decoratedSegments,
    };
  });
}

function hasValidCoords(point) {
  return Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng));
}

async function resolveStopWithSearch(stop, hint) {
  if (!stop?.name) {
    return null;
  }

  if (hasValidCoords(stop)) {
    return {
      ...stop,
      lat: Number(stop.lat),
      lng: Number(stop.lng),
    };
  }

  const { places } = await searchPlaces(hint || stop.name);
  const match = places.find((place) => place.name.includes(stop.name) || stop.name.includes(place.name)) || places[0];

  if (!match) {
    return null;
  }

  return {
    ...stop,
    lat: match.lat,
    lng: match.lng,
    roadAddress: match.roadAddress,
    jibunAddress: match.jibunAddress,
  };
}

function getAccessMinutesUntilSegment(route, busSegmentId) {
  let total = 0;

  for (const segment of route.segments) {
    if (segment.id === busSegmentId) {
      break;
    }

    if (segment.type === 'walk' || segment.type === 'transfer') {
      total += segment.duration;
    }
  }

  return total;
}

function normalizeRealtimeArrivals(data) {
  const candidates = data.result?.real || data.result?.station?.real || data.result?.realtimeArrival || [];

  return candidates.flatMap((item) => {
    const base = {
      routeId: item.routeID || item.routeId || item.busID || null,
      routeName: item.routeNm || item.routeName || item.routeNo || null,
    };
    const arrivals = [];

    const firstArrivalSec = Number(item.arrival1?.arrivalSec ?? item.arrivalSec ?? item.arriveSec1);
    if (Number.isFinite(firstArrivalSec) && firstArrivalSec >= 0) {
      arrivals.push({
        ...base,
        arrivalSec: firstArrivalSec,
        leftStation: Number(item.arrival1?.leftStation ?? item.leftStation ?? item.leftStation1),
      });
    }

    const secondArrivalSec = Number(item.arrival2?.arrivalSec ?? item.arrivalSec2 ?? item.arriveSec2);
    if (Number.isFinite(secondArrivalSec) && secondArrivalSec >= 0) {
      arrivals.push({
        ...base,
        arrivalSec: secondArrivalSec,
        leftStation: Number(item.arrival2?.leftStation ?? item.leftStation2),
      });
    }

    return arrivals;
  }).sort((a, b) => a.arrivalSec - b.arrivalSec);
}

function normalizeRealtimeCandidates(arrivals) {
  return (arrivals || [])
    .map((arrival) => ({
      arrivalSec: Number(arrival.arrivalSec),
      leftStation: Number(arrival.leftStation),
      routeId: arrival.routeId || arrival.routeID || null,
      routeName: arrival.routeName || arrival.routeNm || null,
    }))
    .filter((arrival) => Number.isFinite(arrival.arrivalSec) && arrival.arrivalSec >= 0)
    .sort((a, b) => a.arrivalSec - b.arrivalSec);
}

function normalizeRouteName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/번/g, '')
    .replace(/[^0-9a-z가-힣-]/g, '');
}
function filterArrivalsForSegment(arrivals, routeId, routeName) {
  const normalizedName = normalizeRouteName(routeName);
  const byRouteId = (arrivals || []).filter((arrival) => String(arrival.routeId || '') === String(routeId));

  if (byRouteId.length) {
    return byRouteId;
  }

  return (arrivals || []).filter((arrival) => normalizeRouteName(arrival.routeName) === normalizedName);
}

function pickBestArrival(arrivals, minimumBufferSec) {
  const normalized = normalizeRealtimeCandidates(arrivals);

  if (!normalized.length) {
    return null;
  }

  const safeArrival = normalized.find((arrival) => arrival.arrivalSec >= minimumBufferSec);
  if (safeArrival) {
    return {
      arrival: safeArrival,
      missRiskPenaltyMinutes: 0,
      isTightConnection: false,
    };
  }

  return {
    arrival: normalized[0],
    missRiskPenaltyMinutes: MISS_RISK_PENALTY_MINUTES,
    isTightConnection: true,
  };
}

async function fetchOdsay(url) {
  const response = await fetch(url, {
    method: 'GET',
    mode: 'cors',
    headers: {
      Accept: 'application/json',
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.error) {
    throw new Error(payload.error?.[0]?.message || 'ODSAY 요청에 실패했습니다.');
  }

  return payload;
}

function uniqueStationIds(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

async function fetchBusRealtime(stop, routeId, routeName) {
  const stopCandidates = Array.isArray(stop) ? stop : [stop];
  const stationIds = uniqueStationIds(
    stopCandidates.flatMap((candidate) => [candidate?.stationId, candidate?.localStationId, candidate?.arsId]),
  );

  if (!stationIds.length || (!routeId && !routeName)) {
    return { arrivals: [] };
  }

  const attempts = [];

  for (const stopCandidate of stopCandidates) {
    try {
      const payload = await fetchJson(buildBusRealtimeProxyUrl(stopCandidate, routeId, routeName));
      const arrivals = filterArrivalsForSegment(payload.arrivals || [], routeId, routeName);
      const stationId = stopCandidate?.stationId || stopCandidate?.localStationId || stopCandidate?.arsId || null;
      attempts.push(...(payload.meta?.attempts || [{ source: payload.meta?.source || 'serverRealtime', stationId, routeFiltered: true, count: arrivals.length }]));
      if (arrivals.length) {
        return {
          arrivals,
          meta: {
            ...(payload.meta || {}),
            stationId: payload.meta?.stationId || stationId,
            attempts,
          },
        };
      }
    } catch (error) {
      attempts.push({
        source: 'serverRealtime',
        stationId: stopCandidate?.stationId || stopCandidate?.localStationId || stopCandidate?.arsId || null,
        routeFiltered: Boolean(routeId || routeName),
        error: error instanceof Error ? error.message : '실시간 조회 실패',
      });
    }
  }

  return { arrivals: [], meta: { stationId: stationIds[0] || null, source: 'none', attempts } };
}

function hasRealtimeStopIds(segment) {
  const stops = segment?.realtimeStopCandidates?.length ? segment.realtimeStopCandidates : [segment?.startStop];
  return stops.some((stop) => stop?.stationId || stop?.localStationId || stop?.arsId);
}

function getBusSegments(route) {
  return route.segments.filter((segment) => segment.type === 'bus' && hasRealtimeStopIds(segment) && (segment.routeId || segment.name));
}

async function enrichBusSegmentRealtime(route, segment) {
  const accessMinutes = getAccessMinutesUntilSegment(route, segment.id);
  const minimumBufferSec = (accessMinutes + MINIMUM_BOARDING_BUFFER_MINUTES) * 60;
  const realtimeResponse = await fetchBusRealtime(
    segment.realtimeStopCandidates?.length ? segment.realtimeStopCandidates : segment.startStop,
    segment.routeId,
    segment.name,
  );
  const picked = pickBestArrival(realtimeResponse.arrivals, minimumBufferSec);

  if (!picked) {
    return {
      segmentId: segment.id,
      status: 'unavailable',
      reason: '실시간 정보 없음',
      stopName: segment.startStop?.name || null,
      routeId: segment.routeId,
      routeName: segment.name,
      accessMinutes,
      realtimeMeta: realtimeResponse.meta || null,
    };
  }

  const waitMinutes = Math.ceil(picked.arrival.arrivalSec / 60);
  return {
    segmentId: segment.id,
    status: picked.isTightConnection ? 'tight' : 'live',
    waitMinutes,
    waitSeconds: picked.arrival.arrivalSec,
    leftStation: Number.isFinite(picked.arrival.leftStation) ? picked.arrival.leftStation : null,
    accessMinutes,
    missRiskPenaltyMinutes: picked.missRiskPenaltyMinutes,
    routeId: picked.arrival.routeId || segment.routeId,
    routeName: picked.arrival.routeName || segment.name,
    stopName: segment.startStop?.name || null,
    realtimeMeta: realtimeResponse.meta || null,
  };
}

function applyPrimaryRealtime(route, primaryRealtime) {
  if (!primaryRealtime || !Number.isFinite(primaryRealtime.waitMinutes)) {
    return {
      ...route,
      effectiveTotalTime: route.totalTime,
      effectiveArrivalTime: route.arrivalTime,
      realtime: primaryRealtime || null,
    };
  }

  const effectiveTotalTime = Math.max(
    1,
    route.totalTime + (primaryRealtime.waitMinutes - STATIC_WAIT_BASELINE_MINUTES) + (primaryRealtime.missRiskPenaltyMinutes || 0),
  );

  return {
    ...route,
    effectiveTotalTime,
    effectiveArrivalTime: addMinutes(route.departureTime, effectiveTotalTime).toISOString(),
    realtime: primaryRealtime,
  };
}

export function hasTransitApiKey() {
  return Boolean(ODSAY_API_KEY);
}

export async function getAppMeta() {
  return fetchJson('/api/meta');
}

export async function searchPlaces(query) {
  if (!query.trim()) {
    return { places: [], meta: { demoMode: false } };
  }

  return fetchJson(`/api/places/search?q=${encodeURIComponent(query.trim())}`);
}

export async function reverseGeocode(lat, lng) {
  return fetchJson(`/api/places/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
}

export async function searchTransitRoutes(origin, destination, departureTime) {
  if (!hasTransitApiKey()) {
    throw new Error('VITE_ODSAY_API_KEY가 설정되지 않았습니다.');
  }

  const payload = await fetchOdsay(buildOdsayUrl(origin, destination));

  return {
    routes: normalizeRouteResponse(payload, departureTime),
    meta: {
      demoMode: false,
    },
  };
}

export async function refreshRouteRealtime(route, preferredSegmentId = null) {
  const busSegments = getBusSegments(route);

  if (!busSegments.length) {
    return {
      ...route,
      effectiveTotalTime: route.totalTime,
      effectiveArrivalTime: route.arrivalTime,
      realtime: null,
      realtimeBySegment: {},
    };
  }

  const orderedSegments = preferredSegmentId
    ? [
        ...busSegments.filter((segment) => segment.id === preferredSegmentId),
        ...busSegments.filter((segment) => segment.id !== preferredSegmentId),
      ]
    : busSegments;

  const realtimeEntries = await Promise.all(orderedSegments.map(async (segment) => {
    try {
      return await enrichBusSegmentRealtime(route, segment);
    } catch (error) {
      return {
        segmentId: segment.id,
        status: 'error',
        reason: error instanceof Error ? error.message : '실시간 조회 실패',
        stopName: segment.startStop?.name || null,
        routeId: segment.routeId,
        routeName: segment.name,
        accessMinutes: getAccessMinutesUntilSegment(route, segment.id),
      };
    }
  }));

  const realtimeBySegment = realtimeEntries.reduce((map, realtime) => {
    map[realtime.segmentId] = realtime;
    return map;
  }, {});

  const primarySegment = busSegments[0];
  const primaryRealtime = primarySegment ? realtimeBySegment[primarySegment.id] || null : null;

  return {
    ...applyPrimaryRealtime(route, primaryRealtime),
    realtimeBySegment,
  };
}

export async function enrichRoutesWithRealtime(routes) {
  return Promise.all(routes.map((route) => refreshRouteRealtime(route)));
}

export async function resolveBusSegmentStops(segment) {
  const [startStop, endStop] = await Promise.all([
    resolveStopWithSearch(segment.startStop, segment.stopSearchHints?.start),
    resolveStopWithSearch(segment.endStop, segment.stopSearchHints?.end),
  ]);

  return {
    startStop,
    endStop,
  };
}
