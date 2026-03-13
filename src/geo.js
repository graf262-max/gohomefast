export const DEFAULT_COORDS = { lat: 37.5663, lng: 126.9779 };

export async function getCurrentPosition() {
  if (!navigator.geolocation) {
    return {
      coords: DEFAULT_COORDS,
      accuracy: 0,
      isFallback: true,
    };
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          coords: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          accuracy: position.coords.accuracy,
          isFallback: false,
        });
      },
      () => {
        resolve({
          coords: DEFAULT_COORDS,
          accuracy: 0,
          isFallback: true,
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 30000,
      },
    );
  });
}
