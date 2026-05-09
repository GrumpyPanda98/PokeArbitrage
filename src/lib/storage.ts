import { useCallback, useMemo, useSyncExternalStore } from "react";

type LocalStorageUpdater<T> = T | ((current: T) => T);

const listeners = new Map<string, Set<() => void>>();

function getSnapshot(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(key);
}

function parseSnapshot<T>(snapshot: string | null, fallback: T): T {
  if (!snapshot) {
    return fallback;
  }

  try {
    return JSON.parse(snapshot) as T;
  } catch {
    return fallback;
  }
}

function notify(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

function subscribe(key: string, callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const currentListeners = listeners.get(key) ?? new Set<() => void>();
  currentListeners.add(callback);
  listeners.set(key, currentListeners);

  function onStorage(event: StorageEvent) {
    if (event.key === key) {
      callback();
    }
  }

  window.addEventListener("storage", onStorage);

  return () => {
    currentListeners.delete(callback);
    if (currentListeners.size === 0) {
      listeners.delete(key);
    }
    window.removeEventListener("storage", onStorage);
  };
}

export function useLocalStorageState<T>(
  key: string,
  fallback: T,
): [T, (next: LocalStorageUpdater<T>) => void] {
  const subscribeToKey = useCallback(
    (callback: () => void) => subscribe(key, callback),
    [key],
  );
  const getClientSnapshot = useCallback(() => getSnapshot(key), [key]);
  const snapshot = useSyncExternalStore(
    subscribeToKey,
    getClientSnapshot,
    () => null,
  );

  const value = useMemo(
    () => parseSnapshot(snapshot, fallback),
    [fallback, snapshot],
  );

  const setValue = useCallback(
    (next: LocalStorageUpdater<T>) => {
      if (typeof window === "undefined") {
        return;
      }

      const current = parseSnapshot(getSnapshot(key), fallback);
      const nextValue =
        typeof next === "function"
          ? (next as (currentValue: T) => T)(current)
          : next;

      window.localStorage.setItem(key, JSON.stringify(nextValue));
      notify(key);
    },
    [fallback, key],
  );

  return [value, setValue];
}
