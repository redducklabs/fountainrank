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
  if (pendingRequests > 0) {
    pendingRequests = 0;
    setTimeout(listener, 0);
  }
  return () => listeners.delete(listener);
}
