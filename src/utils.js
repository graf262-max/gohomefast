export const TRANSPORT_ICONS = {
  walk: '도보',
  bus: '버스',
  subway: '지하철',
  transfer: '환승',
};

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) {
    return '-';
  }

  if (minutes < 60) {
    return `${minutes}분`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}시간 ${remainingMinutes}분` : `${hours}시간`;
}

export function formatTime(date) {
  return new Date(date).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatDateTime(date) {
  return new Date(date).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatFare(fare) {
  if (!fare) {
    return '무료';
  }

  return `${Number(fare).toLocaleString('ko-KR')}원`;
}

export function formatMinutesLabel(minutes) {
  if (!Number.isFinite(minutes)) {
    return '-';
  }

  return `${Math.max(0, Math.round(minutes))}분`;
}

export function debounce(fn, delay = 250) {
  let timer;

  return (...args) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

export function toLocalDateTimeValue(date) {
  const current = new Date(date);
  const offset = current.getTimezoneOffset() * 60000;
  return new Date(current.getTime() - offset).toISOString().slice(0, 16);
}

export function getRouteSortTime(route) {
  return route.effectiveTotalTime ?? route.totalTime;
}

export function sortRoutes(routes, sortBy) {
  const list = [...routes];

  switch (sortBy) {
    case 'transfer':
      return list.sort((a, b) => a.transferCount - b.transferCount || getRouteSortTime(a) - getRouteSortTime(b));
    case 'walk':
      return list.sort((a, b) => a.walkTime - b.walkTime || getRouteSortTime(a) - getRouteSortTime(b));
    case 'time':
    default:
      return list.sort((a, b) => getRouteSortTime(a) - getRouteSortTime(b));
  }
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function highlightMatch(text, query) {
  const safeText = escapeHtml(text);

  if (!query) {
    return safeText;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) {
    return safeText;
  }

  return `${escapeHtml(text.slice(0, index))}<strong>${escapeHtml(text.slice(index, index + query.length))}</strong>${escapeHtml(text.slice(index + query.length))}`;
}
