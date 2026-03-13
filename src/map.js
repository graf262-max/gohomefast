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
    };
  }

  const map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(37.5663, 126.9779),
    level: 6,
  });

  const mapObjects = [];
  let routeLine = null;
  let routeOverlay = null;

  function clearObjects() {
    while (mapObjects.length) {
      mapObjects.pop().setMap(null);
    }
    if (routeLine) {
      routeLine.setMap(null);
      routeLine = null;
    }
    if (routeOverlay) {
      routeOverlay.setMap(null);
      routeOverlay = null;
    }
  }

  function setPlaces(origin, destination) {
    clearObjects();

    const places = [origin, destination].filter(Boolean);
    const bounds = new kakao.maps.LatLngBounds();

    places.forEach((place, index) => {
      const position = new kakao.maps.LatLng(place.lat, place.lng);
      const marker = new kakao.maps.Marker({ position, title: place.name });
      marker.setMap(map);
      mapObjects.push(marker);
      bounds.extend(position);

      const label = new kakao.maps.CustomOverlay({
        position,
        yAnchor: 1.7,
        content: `
          <div class="map-label ${index === 0 ? 'origin' : 'destination'}">
            <strong>${index === 0 ? '출발' : '도착'}</strong>
            <span>${place.name}</span>
          </div>
        `,
      });
      label.setMap(map);
      mapObjects.push(label);
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

    if (origin) {
      map.setCenter(new kakao.maps.LatLng(origin.lat, origin.lng));
    }
  }

  function setRouteSummary(summary, destination) {
    if (routeOverlay) {
      routeOverlay.setMap(null);
      routeOverlay = null;
    }

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

  return {
    setPlaces,
    setRouteSummary,
  };
}
