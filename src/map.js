const MAP_APP_KEY = import.meta.env.VITE_KAKAO_MAP_JS_KEY || import.meta.env.KAKAO_MAP_JS_KEY;

let scriptPromise;

function loadKakaoSdk() {
  if (!MAP_APP_KEY) {
    return Promise.resolve(null);
  }

  if (window.kakao?.maps) {
    return Promise.resolve(window.kakao);
  }

  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${MAP_APP_KEY}&autoload=false`;
    script.async = true;
    script.onload = () => {
      window.kakao.maps.load(() => resolve(window.kakao));
    };
    script.onerror = () => reject(new Error('카카오맵 SDK를 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

function createLabelContent(type, title, subtitle) {
  return `
    <div class="map-label ${type}">
      <strong>${title}</strong>
      <span>${subtitle}</span>
    </div>
  `;
}

export async function createTransitMap(container) {
  const kakao = await loadKakaoSdk();

  if (!kakao) {
    container.classList.add('map-fallback');
    container.innerHTML = `
      <div class="map-fallback-copy">
        <strong>카카오맵 키가 없어 지도를 표시하지 못했습니다.</strong>
        <span>.env에 VITE_KAKAO_MAP_JS_KEY를 추가하면 실제 지도가 표시됩니다.</span>
      </div>
    `;
    return {
      setPlaces() {},
      setRouteSummary() {},
      setSegmentFocus() {},
      clearSegmentFocus() {},
    };
  }

  const map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(37.5663, 126.9779),
    level: 6,
  });

  const placeObjects = [];
  const focusObjects = [];
  let routeLine = null;
  let routeOverlay = null;
  let originPlace = null;
  let destinationPlace = null;

  function clearObjectList(list) {
    while (list.length) {
      list.pop().setMap(null);
    }
  }

  function clearRouteLine() {
    if (routeLine) {
      routeLine.setMap(null);
      routeLine = null;
    }
  }

  function clearRouteOverlay() {
    if (routeOverlay) {
      routeOverlay.setMap(null);
      routeOverlay = null;
    }
  }

  function createOverlay(position, content, list) {
    const overlay = new kakao.maps.CustomOverlay({
      position,
      yAnchor: 1.7,
      content,
    });
    overlay.setMap(map);
    list.push(overlay);
  }

  function setPlaces(origin, destination) {
    originPlace = origin;
    destinationPlace = destination;
    clearObjectList(placeObjects);
    clearObjectList(focusObjects);
    clearRouteLine();
    clearRouteOverlay();

    const places = [origin, destination].filter(Boolean);

    if (!places.length) {
      map.setCenter(new kakao.maps.LatLng(37.5663, 126.9779));
      return;
    }

    const bounds = new kakao.maps.LatLngBounds();

    places.forEach((place, index) => {
      const position = new kakao.maps.LatLng(place.lat, place.lng);
      const marker = new kakao.maps.Marker({ position, title: place.name });
      marker.setMap(map);
      placeObjects.push(marker);
      bounds.extend(position);

      createOverlay(
        position,
        createLabelContent(index === 0 ? 'origin' : 'destination', index === 0 ? '출발' : '도착', place.name),
        placeObjects,
      );
    });

    if (origin && destination) {
      routeLine = new kakao.maps.Polyline({
        path: [
          new kakao.maps.LatLng(origin.lat, origin.lng),
          new kakao.maps.LatLng(destination.lat, destination.lng),
        ],
        strokeWeight: 4,
        strokeColor: '#0f766e',
        strokeOpacity: 0.8,
        strokeStyle: 'dashed',
      });
      routeLine.setMap(map);
      map.setBounds(bounds, 40, 40, 40, 40);
      return;
    }

    map.setCenter(new kakao.maps.LatLng(places[0].lat, places[0].lng));
  }

  function setRouteSummary(summary, destination) {
    clearRouteOverlay();

    if (!summary || !destination) {
      return;
    }

    routeOverlay = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(destination.lat, destination.lng),
      yAnchor: 0,
      content: `
        <div class="route-overlay">
          <strong>${summary.title}</strong>
          <span>${summary.description}</span>
        </div>
      `,
    });
    routeOverlay.setMap(map);
  }

  function clearSegmentFocus() {
    clearObjectList(focusObjects);
  }

  function setSegmentFocus(segment, message) {
    clearSegmentFocus();

    if (!segment?.startStop || !segment?.endStop) {
      return;
    }

    const bounds = new kakao.maps.LatLngBounds();
    const points = [originPlace, destinationPlace, segment.startStop, segment.endStop].filter(Boolean);

    points.forEach((point) => {
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
        return;
      }

      const position = new kakao.maps.LatLng(point.lat, point.lng);
      bounds.extend(position);
    });

    const focusStops = [
      { stop: segment.startStop, type: 'stop-start', title: '승차 정류장' },
      { stop: segment.endStop, type: 'stop-end', title: '하차 정류장' },
    ];

    focusStops.forEach(({ stop, type, title }) => {
      if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) {
        return;
      }

      const position = new kakao.maps.LatLng(stop.lat, stop.lng);
      const marker = new kakao.maps.Marker({ position, title: stop.name });
      marker.setMap(map);
      focusObjects.push(marker);

      createOverlay(position, createLabelContent(type, title, stop.name), focusObjects);
    });

    if (!bounds.isEmpty()) {
      map.setBounds(bounds, 60, 60, 60, 60);
    }

    if (!message || !segment.endStop || !Number.isFinite(segment.endStop.lat) || !Number.isFinite(segment.endStop.lng)) {
      return;
    }

    clearRouteOverlay();
    routeOverlay = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(segment.endStop.lat, segment.endStop.lng),
      yAnchor: 0,
      content: `
        <div class="route-overlay">
          <strong>${segment.name}</strong>
          <span>${message}</span>
        </div>
      `,
    });
    routeOverlay.setMap(map);
  }

  return {
    setPlaces,
    setRouteSummary,
    setSegmentFocus,
    clearSegmentFocus,
  };
}
