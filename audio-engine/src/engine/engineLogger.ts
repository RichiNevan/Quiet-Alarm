// Error-reporting seam. The engine records non-fatal errors here instead of
// hard-importing the host app's crashlytics. Defaults to a no-op so the package
// runs standalone; the host app injects its reporter via setEngineErrorReporter
// (e.g. setEngineErrorReporter(crashlytics) at startup).

export type EngineErrorReporter = {
  recordError: (error: unknown) => void;
  log?: (message: string) => void;
};

let reporter: EngineErrorReporter = {
  recordError: () => {},
  log: () => {},
};

export function setEngineErrorReporter(next: EngineErrorReporter): void {
  reporter = {
    recordError: next.recordError ?? (() => {}),
    log: next.log ?? (() => {}),
  };
}

// Exposed as `crashlytics` so moved engine files only need their import path
// changed (usage sites like `crashlytics.recordError(e)` stay identical).
export const crashlytics: Required<EngineErrorReporter> = {
  recordError: (error: unknown) => reporter.recordError(error),
  log: (message: string) => reporter.log?.(message),
};
