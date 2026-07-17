// Shared runtime toggle + ring buffer for the breathing/rooms session
// diagnostics probes (`breathingDebug` in settingsContext, `roomDebug` in
// SelectedSessionView, `nativeRoomDebug` in SessionManager, `webAvsRoomDebug`
// in webAVS). Silent by default; enable at runtime instead of recompiling:
//
//   - from a browser console / Playwright: `__BSC_SET_SESSION_DEBUG__(true)`
//     (persists in localStorage so it survives reloads on web);
//   - from code (admin/debug surfaces): `setSessionDebugEnabled(true)`.
//
// Events go to `console.warn` (the only console level lint allows besides
// error) AND a bounded in-memory ring buffer readable via
// `getSessionDebugEvents()` / `__BSC_SESSION_DEBUG_EVENTS__()`, so a field
// repro on Safari or Android can be traced after the fact instead of only
// while watching the console. See
// referenceDocuments/currentWork/PLATFORM_ROOM_STABILITY_PLAN.md § Phase 0.

const SESSION_DEBUG_STORAGE_KEY = 'biosyncare:sessionDebug';
const RING_BUFFER_LIMIT = 300;

const readPersistedFlag = () => {
  try {
    return (
      typeof window !== 'undefined' &&
      window.localStorage?.getItem(SESSION_DEBUG_STORAGE_KEY) === '1'
    );
  } catch {
    return false;
  }
};

let enabled = readPersistedFlag();
const events = [];

export const isSessionDebugEnabled = () => enabled;

export const setSessionDebugEnabled = (value) => {
  enabled = Boolean(value);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (enabled) {
        window.localStorage.setItem(SESSION_DEBUG_STORAGE_KEY, '1');
      } else {
        window.localStorage.removeItem(SESSION_DEBUG_STORAGE_KEY);
      }
    }
  } catch {
    // Persistence is best-effort; the in-memory flag still applies.
  }
  return enabled;
};

/**
 * Record one probe event. Returns the entry, or null while debug is disabled
 * so probe call sites stay cheap in production.
 */
export const recordSessionDebugEvent = (scope, event, payload = {}) => {
  if (!enabled) return null;
  const entry = { scope, event, at: new Date().toISOString(), ...payload };
  events.push(entry);
  if (events.length > RING_BUFFER_LIMIT) {
    events.splice(0, events.length - RING_BUFFER_LIMIT);
  }
  console.warn(`[${scope}] ${event}`, entry);
  return entry;
};

export const getSessionDebugEvents = () => events.slice();

export const clearSessionDebugRing = () => {
  events.length = 0;
};

// Console handles for field debugging (Safari devtools, chrome://inspect).
globalThis.__BSC_SET_SESSION_DEBUG__ = setSessionDebugEnabled;
globalThis.__BSC_SESSION_DEBUG_EVENTS__ = getSessionDebugEvents;
