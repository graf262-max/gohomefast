const ODSAY_API_KEY = import.meta.env.VITE_ODSAY_API_KEY || '';

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

function extractStops(subPath) {
  return subPath.passStopList?.stations?.map((station) => ({
    name: station.stationName,
    lat: station.y ? Number(station.y) : null,
    lng: station.x ? Number(station.x) : null,
  })).filter((station) => station.name) || [];
}

function toStop(name, lat, lng) {
  if (!name) {
    return null;
  }

  const normalizedLat = Number(lat);
  const normalizedLng = Number(lng);
  return {
    name,
    lat: Number.isFinite(normalizedLat) ? normalizedLat : null,
    lng: Number.isFinite(normalizedLng) ? normalizedLng : null,
  };
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

function buildStopQuery(stopName, routeName) {
  return `${stopName} ${routeName}`.trim();
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
        const startStop = toStop(subPath.startName, subPath.startY, subPath.startX);
        const endStop = toStop(subPath.endName, subPath.endY, subPath.endX);

        segments.push({
          id: `route-${routeIndex + 1}-bus-${segments.length + 1}`,
          type: 'bus',
          name: routeName,
          duration: subPath.sectionTime,
          detail: `${subPath.startName} -> ${subPath.endName} · ${getBusTypeLabel(lane.type)}`,
          color: '#2563eb',
          startStop,
          endStop,
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
          startStop: toStop(subPath.startName, subPath.startY, subPath.startX),
          endStop: toStop(subPath.endName, subPath.endY, subPath.endX),
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
      transferCount: Math.max(((info.busTransitCount || 0) + (info.subwayTransitCount || 0)) - 1, 0),
      walkTime: info.totalWalk
        ? Math.round(info.totalWalk / 60)
        : decoratedSegments
          .filter((segment) => segment.type === 'walk')
          .reduce((sum, segment) => sum + segment.duration, 0),
      fare: info.payment || 0,
      departureTime: baseTime.toISOString(),
      arrivalTime: addMinutes(baseTime, totalTime).toISOString(),
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
    name: stop.name,
    lat: match.lat,
    lng: match.lng,
    roadAddress: match.roadAddress,
    jibunAddress: match.jibunAddress,
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

  const response = await fetch(buildOdsayUrl(origin, destination), {
    method: 'GET',
    mode: 'cors',
    headers: {
      Accept: 'application/json',
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error?.[0]?.message || '대중교통 경로 조회에 실패했습니다.');
  }

  if (payload.error) {
    throw new Error(payload.error?.[0]?.message || '대중교통 경로 조회에 실패했습니다.');
  }

  return {
    routes: normalizeRouteResponse(payload, departureTime),
    meta: {
      demoMode: false,
    },
  };
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
