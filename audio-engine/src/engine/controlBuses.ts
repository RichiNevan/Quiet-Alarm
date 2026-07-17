import EventEmitter from 'events';

// Engine <-> host event seam. The web engine emits voice/session control events
// on these buses. Defaults to internal EventEmitters so the package works
// standalone; the host app injects its own buses via setEngineControlBuses so
// its existing subscribers (e.g. contexts/eventBuses) receive engine events.
//
// Exported as `let` live bindings: after the host calls setEngineControlBuses,
// importers that reference `volumeBus`/`stopSessionBus` see the injected buses
// (Metro/Babel compile named imports to namespace lookups).

export let volumeBus: EventEmitter = new EventEmitter();
export let stopSessionBus: EventEmitter = new EventEmitter();

export function setEngineControlBuses(buses: {
  volumeBus?: EventEmitter;
  stopSessionBus?: EventEmitter;
}): void {
  if (buses.volumeBus) volumeBus = buses.volumeBus;
  if (buses.stopSessionBus) stopSessionBus = buses.stopSessionBus;
}
