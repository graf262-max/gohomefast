import { MOCK_HOME_OFFICE } from './mock-data.js';

const STORAGE_KEY = 'transit-finder.saved-places';

export function loadSavedPlaces() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return MOCK_HOME_OFFICE;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return MOCK_HOME_OFFICE;
    }

    return parsed;
  } catch {
    return MOCK_HOME_OFFICE;
  }
}

export function saveSavedPlace(label, place) {
  const current = loadSavedPlaces().filter((item) => item.label !== label);
  const next = [...current, { label, place }];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
