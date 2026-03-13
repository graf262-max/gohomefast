import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = express();
const port = Number(process.env.PORT || 8787);
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json());

const MOCK_PLACES = [
  { id: 'mock-gangnam', name: '강남역', roadAddress: '서울 강남구 강남대로 396', jibunAddress: '서울 강남구 역삼동 858', lat: 37.4979, lng: 127.0276, source: 'mock' },
  { id: 'mock-cityhall', name: '서울시청', roadAddress: '서울 중구 세종대로 110', jibunAddress: '서울 중구 태평로1가 31', lat: 37.5663, lng: 126.9779, source: 'mock' },
  { id: 'mock-seoulstation', name: '서울역', roadAddress: '서울 용산구 한강대로 405', jibunAddress: '서울 용산구 동자동 43-205', lat: 37.5547, lng: 126.9707, source: 'mock' },
  { id: 'mock-pangyo', name: '판교역', roadAddress: '경기 성남시 분당구 판교역로 160', jibunAddress: '경기 성남시 분당구 백현동 540', lat: 37.3947, lng: 127.1112, source: 'mock' },
  { id: 'mock-jamsil', name: '잠실역', roadAddress: '서울 송파구 올림픽로 265', jibunAddress: '서울 송파구 신천동 8', lat: 37.5133, lng: 127.1002, source: 'mock' },
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
    roadAddress: '서울특별시 중심권(데모)',
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
        { type: 'walk', name: '도보 이동', duration: 4, detail: `${origin.name}에서 인근 역까지 이동`, stops: [] },
        { type: 'subway', name: '2호선', duration: 17, detail: '강남역 방면 탑승', color: '#33A23D', stops: ['출발역', '환승역'] },
        { type: 'transfer', name: '환승', duration: 3, detail: '도보 환승', stops: [] },
        { type: 'bus', name: '9401번', duration: 7, detail: `${destination.name} 인근 정류장 하차`, color: '#3b82f6', stops: ['환승 정류장', '도착 정류장'] },
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
        { type: 'walk', name: '도보 이동', duration: 5, detail: `${origin.name}에서 버스 정류장까지 이동`, stops: [] },
        { type: 'bus', name: '472번', duration: 24, detail: `${destination.name} 방향 간선버스`, color: '#2563eb', stops: ['출발 정류장', '중간 정류장', '도착 정류장'] },
        { type: 'walk', name: '도보 이동', duration: 7, detail: '하차 후 최종 도보 이동', stops: [] },
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
        { type: 'walk', name: '도보 이동', duration: 2, detail: '가까운 역으로 이동', stops: [] },
        { type: 'subway', name: '9호선 급행', duration: 20, detail: '주요 구간 급행 이동', color: '#C6A546', stops: ['출발역', '환승역'] },
        { type: 'transfer', name: '환승', duration: 2, detail: '환승 통로 이동', stops: [] },
        { type: 'subway', name: '분당선', duration: 20, detail: `${destination.name} 인근 역 하차`, color: '#f59e0b', stops: ['환승역', '도착역'] },
      ],
    },
  ];
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
          name: '도보 이동',
          duration: subPath.sectionTime,
          detail: `${subPath.distance || 0}m 이동`,
          stops: extractStops(subPath),
        });
        continue;
      }

      if (subPath.trafficType === 2) {
        const lane = subPath.lane?.[0] || {};
        segments.push({
          type: 'bus',
          name: lane.busNo ? `${lane.busNo}번` : '버스',
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
          name: lane.name || '지하철',
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
          name: '환승',
          duration: 3,
          detail: `${segment.name}에서 ${nextSegment.name}으로 환승`,
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
    throw new Error(`Kakao API 요청 실패 (${response.status})`);
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
    throw new Error(`ODSAY API 요청 실패 (${response.status})`);
  }

  return response.json();
}

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
        response.status(503).json({ message: '장소 검색 API가 아직 설정되지 않았습니다.' });
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
    const message = error instanceof Error ? error.message : '장소 검색 중 오류가 발생했습니다.';
    response.status(502).json({ message });
  }
});

app.get('/api/places/reverse', async (request, response) => {
  const lat = Number(request.query.lat);
  const lng = Number(request.query.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    response.status(400).json({ message: '유효한 좌표가 필요합니다.' });
    return;
  }

  try {
    if (!process.env.KAKAO_REST_API_KEY) {
      if (isProduction) {
        response.status(503).json({ message: '역지오코딩 API가 아직 설정되지 않았습니다.' });
        return;
      }

      response.json({
        place: {
          id: `reverse-${lat}-${lng}`,
          name: '현재 위치',
          roadAddress: '서울특별시 중심권(데모)',
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
        name: roadAddress || jibunAddress || '현재 위치',
        roadAddress,
        jibunAddress,
        lat,
        lng,
        source: 'kakao',
      },
      meta: getServerMeta(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '현재 위치 주소를 불러오지 못했습니다.';
    response.status(502).json({ message });
  }
});

app.post('/api/routes/transit', async (request, response) => {
  const { origin, destination, departureTime } = request.body || {};
  const validPlace = (place) => place && Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lng)) && place.name;

  if (!validPlace(origin) || !validPlace(destination)) {
    response.status(400).json({ message: '출발지와 도착지를 모두 확정해 주세요.' });
    return;
  }

  try {
    if (!process.env.ODSAY_API_KEY) {
      if (isProduction) {
        response.status(503).json({ message: '대중교통 경로 API가 아직 설정되지 않았습니다.' });
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
      response.status(502).json({ message: data.error.msg || '대중교통 경로를 불러오지 못했습니다.' });
      return;
    }

    response.json({
      routes: normalizeRouteResponse(data, departureTime),
      meta: getServerMeta(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '대중교통 경로 조회 중 오류가 발생했습니다.';
    response.status(502).json({ message });
  }
});

if (isProduction) {
  app.use(express.static(path.join(rootDir, 'build')));
  app.get('*', (_request, response) => {
    response.sendFile(path.join(rootDir, 'build', 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Transit Finder API server listening on http://localhost:${port}`);
});
