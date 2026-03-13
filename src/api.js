async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || '요청을 처리하지 못했습니다.');
  }

  return payload;
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
  return fetchJson('/api/routes/transit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      origin,
      destination,
      departureTime,
    }),
  });
}
