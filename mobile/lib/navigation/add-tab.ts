const listeners = new Set<() => void>();
let pendingRequests = 0;

export function requestMapAddMode() {
  if (listeners.size === 0) {
    pendingRequests += 1;
    return;
  }
  listeners.forEach((listener) => listener());
}

export function subscribeMapAddMode(listener: () => void): () => void {
  listeners.add(listener);
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  if (pendingRequests > 0) {
    pendingRequests = 0;
    pendingTimer = setTimeout(listener, 0);
  }
  return () => {
    listeners.delete(listener);
    if (pendingTimer) clearTimeout(pendingTimer);
  };
}
