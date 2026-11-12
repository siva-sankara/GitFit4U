import { lazy, type ComponentType, type LazyExoticComponent } from "react";

type LazyModule<T extends ComponentType<any>> = { default: T };

type RetryOptions = {
  delays?: readonly number[];
  reloadOnFailure?: boolean;
  reload?: () => void;
  now?: () => number;
};

const DEFAULT_RETRY_DELAYS = [0, 250, 900] as const;
const RELOAD_GUARD_MS = 30_000;
const RELOAD_MARKER_PREFIX = "getfit4u:lazy-module-reload:";

export function isDynamicImportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch dynamically imported module|importing a module script failed|chunkloaderror|loading chunk|failed to load module script/i.test(
    message,
  );
}

function wait(delay: number) {
  return delay > 0
    ? new Promise<void>((resolve) => {
        window.setTimeout(resolve, delay);
      })
    : Promise.resolve();
}

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Retries transient module fetch failures and performs at most one guarded hard
 * refresh. A refresh is needed when a deployment replaced a chunk referenced by
 * an already-open browser tab. Programming/rendering errors are never retried.
 */
export async function loadLazyModule<T extends ComponentType<any>>(
  key: string,
  importer: () => Promise<LazyModule<T>>,
  options: RetryOptions = {},
): Promise<LazyModule<T>> {
  const delays = options.delays ?? DEFAULT_RETRY_DELAYS;
  const marker = `${RELOAD_MARKER_PREFIX}${key}`;
  const storage = sessionStorageOrNull();
  let lastError: unknown;

  for (const delay of delays) {
    await wait(delay);
    try {
      const loaded = await importer();
      storage?.removeItem(marker);
      return loaded;
    } catch (error) {
      lastError = error;
      if (!isDynamicImportError(error)) throw error;
    }
  }

  if (options.reloadOnFailure !== false && typeof window !== "undefined" && storage) {
    const now = (options.now ?? Date.now)();
    const previousReload = Number(storage?.getItem(marker) ?? 0);
    if (!previousReload || now - previousReload > RELOAD_GUARD_MS) {
      storage?.setItem(marker, String(now));
      (options.reload ?? (() => window.location.reload()))();
      // Keep Suspense active until the browser starts the guarded refresh.
      return new Promise<LazyModule<T>>(() => {
        // The browser navigation replaces this document.
      });
    }
  }

  throw lastError;
}

export function lazyWithRetry<T extends ComponentType<any>>(
  key: string,
  importer: () => Promise<LazyModule<T>>,
): LazyExoticComponent<T> {
  return lazy(() => loadLazyModule(key, importer));
}
