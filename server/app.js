import express from 'express';

const isProduction = process.env.NODE_ENV === 'production';

const MOCK_PLACES = [
  { id: 'mock-gangnam', name: 'Gangnam Station', roadAddress: '396 Gangnam-daero, Gangnam-gu, Seoul', jibunAddress: '858 Yeoksam-dong, Gangnam-gu, Seoul', lat: 37.4979, lng: 127.0276, source: 'mock' },
  { id: 'mock-cityhall', name: 'Seoul City Hall', roadAddress: '110 Sejong-daero, Jung-gu, Seoul', jibunAddress: '31 Taepyeongno 1-ga, Jung-gu, Seoul', lat: 37.5663, lng: 126.9779, source: 'mock' },
  { id: 'mock-seoulstation', name: 'Seoul Station', roadAddress: '405 Hangang-daero, Yongsan-gu, Seoul', jibunAddress: '43-205 Dongja-dong, Yongsan-gu, Seoul', lat: 37.5547, lng: 126.9707, source: 'mock' },
  { id: 'mock-pangyo', name: 'Pangyo Station', roadAddress: '160 Pangyoyeok-ro, Bundang-gu, Seongnam-si', jibunAddress: '540 Baekhyeon-dong, Bundang-gu, Seongnam-si', lat: 37.3947, lng: 127.1112, source: 'mock' },
  { id: 'mock-jamsil', name: 'Jamsil Station', roadAddress: '265 Olympic-ro, Songpa-gu, Seoul', jibunAddress: '8 Sincheon-dong, Songpa-gu, Seoul', lat: 37.5133, lng: 127.1002, source: 'mock' },
];

function getServerMeta() {
  return {
    demoMode: !process.env.KAKAO_REST_API_KEY || !process.env.ODSAY_API_KEY,
    hasMapKey: Boolean(process.env.VITE_KAKAO_MAP_JS_KEY || process.env.KAKAO_MAP_JS_KEY),
  };
}

function toPlace(doc) {
  return {
    id: `kakao-${doc.id || doc.place_name}-${doc.x}-${doc.y}`,
    name: doc.place_name || doc.address_name || doc.road_address_name,
    roadAddress: doc.road_address_name || '',
    jibunAddress: doc.address_name || '',
    lat: Number(doc.y),
    lng: Number(doc.x),
    source: 'kakao',
  };
}

function makeMockPlace(query) {
  return {
    id: `mock-query-${encodeURIComponent(query)}`,
    name: query,
    roadAddress: 'Central Seoul (demo)',
    jibunAddress: '',
    lat: 37.5665 + (Math.random() - 0.5) * 0.06,
    lng: 126.978 + (Math.random() - 0.5) * 0.06,
    source: 'mock',
  };
}

function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + minutes * 60000);
}

function generateMockRoutes(origin, destination, departureTime) {
  const start = departureTime ? new Date(departureTime) : new Date();
  return [
    {
      id: 1,
      totalTime: 31,
      transferCount: 1,
      walkTime: 8,
      fare: 1400,
      departureTime: start.toISOString(),
      arrivalTime: addMinutes(start, 31).toISOString(),
      segments: [
        { type: 'walk', name: 'Walk', duration: 4, detail: `Walk from ${origin.name} to the nearest station`, stops: [] },
        { type: 'subway', name: 'Line 2', duration: 17, detail: 'Board toward Gangnam', color: '#33A23D', stops: ['Origin Station', 'Transfer Station'] },
        { type: 'transfer', name: 'Transfer', duration: 3, detail: 'Transfer on foot', stops: [] },
        { type: 'bus', name: '9401', duration: 7, detail: `Get off near ${destination.name}`, color: '#3b82f6', stops: ['Transfer Stop', 'Destination Stop'] },
      ],
    },
    {
      id: 2,
      totalTime: 36,
      transferCount: 0,
      walkTime: 12,
      fare: 1400,
      departureTime: start.toISOString(),
      arrivalTime: addMinutes(start, 36).toISOString(),
      segments: [
        { type: 'walk', name: 'Walk', duration: 5, detail: `Walk from ${origin.name} to the bus stop`, stops: [] },
        { type: 'bus', name: '472', duration: 24, detail: `Direct bus toward ${destination.name}`, color: '#2563eb', stops: ['Origin Stop', 'Midway Stop', 'Destination Stop'] },
        { type: 'walk', name: 'Walk', duration: 7, detail: 'Final walk after getting off', stops: [] },
      ],
    },
    {
      id: 3,
      totalTime: 44,
      transferCount: 1,
      walkTime: 6,
      fare: 1550,
      departureTime: start.toISOString(),
      arrivalTime: addMinutes(start, 44).toISOString(),
      segments: [
        { type: 'walk', name: 'Walk', duration: 2, detail: 'Walk to the nearby station', stops: [] },
        { type: 'subway', name: 'Line 9 Express', duration: 20, detail: 'Express section', color: '#C6A546', stops: ['Origin Station', 'Transfer Station'] },
        { type: 'transfer', name: 'Transfer', duration: 2, detail: 'Move through the transfer corridor', stops: [] },
        { type: 'subway', name: 'Bundang Line', duration: 20, detail: `Get off near ${destination.name}`, color: '#f59e0b', stops: ['Transfer Station', 'Destination Station'] },
      ],
    },
  ];
}

function getBusTypeLabel(type) {
  const map = {
    1: 'Regular',
    2: 'Seat',
    3: 'Village',
    4: 'Express',
    5: 'Airport',
    6: 'Main Line',
    10: 'Outer',
    11: 'Main Line',
    12: 'Branch',
    13: 'Circular',
    14: 'Metro Express',
    15: 'Village',
  };
  return map[type] || 'Bus';
}

function extractStops(subPath) {
  return subPath.passStopList?.stations?.map((station) => station.stationName).filter(Boolean) || [subPath.startName, subPath.endName].filter(Boolean);
}

function normalizeRouteResponse(data, departureTime) {
  const baseTime = departureTime ? new Date(departureTime) : new Date();
  const paths = data.result?.path || [];

  return paths.map((pathItem, index) => {
    const info = pathItem.info || {};
    const segments = [];

    for (const subPath of pathItem.subPath || []) {
      if (!subPath.sectionTime) {
        continue;
      }

      if (subPath.trafficType === 3) {
        segments.push({
          type: 'walk',
          name: 'Walk',
          duration: subPath.sectionTime,
          detail: `${subPath.distance || 0}m walk`,
          stops: extractStops(subPath),
        });
        continue;
      }

      if (subPath.trafficType === 2) {
        const lane = subPath.lane?.[0] || {};
        segments.push({
          type: 'bus',
          name: lane.busNo ? `${lane.busNo}` : 'Bus',
          duration: subPath.sectionTime,
          detail: `${subPath.startName} → ${subPath.endName} · ${getBusTypeLabel(lane.type)}`,
          color: '#2563eb',
          stops: extractStops(subPath),
        });
        continue;
      }

      if (subPath.trafficType === 1) {
        const lane = subPath.lane?.[0] || {};
        segments.push({
          type: 'subway',
          name: lane.name || 'Subway',
          duration: subPath.sectionTime,
          detail: `${subPath.startName} → ${subPath.endName}`,
          color: lane.subwayColor ? `#${lane.subwayColor}` : undefined,
          stops: extractStops(subPath),
        });
      }
    }

    const decoratedSegments = [];
    segments.forEach((segment, segmentIndex) => {
      decoratedSegments.push(segment);
      const nextSegment = segments[segmentIndex + 1];
      if (!nextSegment) {
        return;
      }
      if (segment.type !== 'walk' && nextSegment.type !== 'walk' && segment.type !== nextSegment.type) {
        decoratedSegments.push({
          type: 'transfer',
          name: 'Transfer',
          duration: 3,
          detail: `Transfer from ${segment.name} to ${nextSegment.name}`,
          stops: [],
        });
      }
    });

    const transferCount = Math.max(((info.busTransitCount || 0) + (info.subwayTransitCount || 0)) - 1, 0);

    return {
      id: index + 1,
      totalTime: info.totalTime || decoratedSegments.reduce((sum, segment) => sum + segment.duration, 0),
      transferCount,
      walkTime: info.totalWalk ? Math.round(info.totalWalk / 60) : decoratedSegments.filter((segment) => segment.type === 'walk').reduce((sum, segment) => sum + segment.duration, 0),
      fare: info.payment || 0,
      departureTime: baseTime.toISOString(),
      arrivalTime: addMinutes(baseTime, info.totalTime || 0).toISOString(),
      segments: decoratedSegments,
    };
  });
}

async function kakaoRequest(endpoint, params) {
  const url = new URL(`https://dapi.kakao.com${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url, {
    headers: {
      Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Kakao API request failed (${response.status})`);
  }

  return response.json();
}

async function odsayTransitRequest({ origin, destination }) {
  const url = new URL('https://api.odsay.com/v1/api/searchPubTransPathT');
  url.searchParams.set('SX', String(origin.lng));
  url.searchParams.set('SY', String(origin.lat));
  url.searchParams.set('EX', String(destination.lng));
  url.searchParams.set('EY', String(destination.lat));
  url.searchParams.set('apiKey', process.env.ODSAY_API_KEY);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ODsay API request failed (${response.status})`);
  }

  return response.json();
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/meta', (_request, response) => {
    response.json(getServerMeta());
  });

  app.get('/api/places/search', async (request, response) => {
    const query = String(request.query.q || '').trim();

    if (!query) {
      response.json({ places: [], meta: getServerMeta() });
      return;
    }

    try {
      if (!process.env.KAKAO_REST_API_KEY) {
        if (isProduction) {
          response.status(503).json({ message: 'Place search API key is not configured.' });
          return;
        }

        const matched = MOCK_PLACES.filter((place) => {
          const haystack = `${place.name} ${place.roadAddress} ${place.jibunAddress}`.toLowerCase();
          return haystack.includes(query.toLowerCase());
        }).slice(0, 5);

        response.json({
          places: matched.length ? matched : [makeMockPlace(query)],
          meta: getServerMeta(),
        });
        return;
      }

      const data = await kakaoRequest('/v2/local/search/keyword.json', { query, size: '7' });
      response.json({
        places: (data.documents || []).map(toPlace),
        meta: getServerMeta(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Place search failed.';
      response.status(502).json({ message });
    }
  });

  app.get('/api/places/reverse', async (request, response) => {
    const lat = Number(request.query.lat);
    const lng = Number(request.query.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      response.status(400).json({ message: 'Valid coordinates are required.' });
      return;
    }

    try {
      if (!process.env.KAKAO_REST_API_KEY) {
        if (isProduction) {
          response.status(503).json({ message: 'Reverse geocoding API key is not configured.' });
          return;
        }

        response.json({
          place: {
            id: `reverse-${lat}-${lng}`,
            name: 'Current Location',
            roadAddress: 'Central Seoul (demo)',
            jibunAddress: '',
            lat,
            lng,
            source: 'mock',
          },
          meta: getServerMeta(),
        });
        return;
      }

      const data = await kakaoRequest('/v2/local/geo/coord2address.json', {
        x: String(lng),
        y: String(lat),
      });

      const address = data.documents?.[0];
      const roadAddress = address?.road_address?.address_name || '';
      const jibunAddress = address?.address?.address_name || '';
      response.json({
        place: {
          id: `reverse-${lat}-${lng}`,
          name: roadAddress || jibunAddress || 'Current Location',
          roadAddress,
          jibunAddress,
          lat,
          lng,
          source: 'kakao',
        },
        meta: getServerMeta(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reverse geocoding failed.';
      response.status(502).json({ message });
    }
  });

  app.post('/api/routes/transit', async (request, response) => {
    const { origin, destination, departureTime } = request.body || {};
    const validPlace = (place) => place && Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lng)) && place.name;

    if (!validPlace(origin) || !validPlace(destination)) {
      response.status(400).json({ message: 'Both origin and destination must be confirmed.' });
      return;
    }

    try {
      if (!process.env.ODSAY_API_KEY) {
        if (isProduction) {
          response.status(503).json({ message: 'Transit routing API key is not configured.' });
          return;
        }

        response.json({
          routes: generateMockRoutes(origin, destination, departureTime),
          meta: getServerMeta(),
        });
        return;
      }

      const data = await odsayTransitRequest({ origin, destination });
      if (data.error) {
        response.status(502).json({ message: data.error.msg || 'Transit routing failed.' });
        return;
      }

      response.json({
        routes: normalizeRouteResponse(data, departureTime),
        meta: getServerMeta(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transit routing failed.';
      response.status(502).json({ message });
    }
  });

  return app;
}
