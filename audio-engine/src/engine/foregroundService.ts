// Optional Android media-playback foreground-service seam. Keeps the app process
// alive so a backgrounded session keeps playing. Defaults to a no-op; the host
// app injects its lease (e.g. audio/audioForegroundServiceLease, which is
// Android-only and stays app-side) via setForegroundServiceController.
//
// Failure-isolated by the caller (SessionManager wraps these in try/catch): an
// FGS problem must never affect playback.

export type ForegroundServiceController = {
  acquire: (reason: string) => void;
  release: (reason: string) => void;
};

let controller: ForegroundServiceController = {
  acquire: () => {},
  release: () => {},
};

export function setForegroundServiceController(
  next: Partial<ForegroundServiceController>,
): void {
  controller = {
    acquire: next.acquire ?? (() => {}),
    release: next.release ?? (() => {}),
  };
}

export function acquireForegroundService(reason: string): void {
  controller.acquire(reason);
}

export function releaseForegroundService(reason: string): void {
  controller.release(reason);
}
