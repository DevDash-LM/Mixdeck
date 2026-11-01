/** Throttling with a guaranteed trailing call (the last value always gets written). */

export interface Throttled<A extends unknown[]> {
  (...args: A): void;
  /** Runs a pending trailing call now. */
  flush(): void;
  /** Drops a pending trailing call. */
  cancel(): void;
}

/** Calls `fn` at most once per `ms`, leading and trailing, with the latest arguments. */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): Throttled<A> {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const run = () => {
    timer = null;
    if (!pending) return;
    const args = pending;
    pending = null;
    last = performance.now();
    fn(...args);
  };

  const throttled = (...args: A) => {
    pending = args;
    const wait = ms - (performance.now() - last);
    if (wait <= 0 && !timer) run();
    else if (!timer) timer = setTimeout(run, Math.max(0, wait));
  };
  throttled.flush = () => {
    if (timer) clearTimeout(timer);
    run();
  };
  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return throttled;
}

/** One independent throttle per key (e.g. per parameter name). */
export function keyedThrottle<V>(fn: (key: string, value: V) => void, ms: number) {
  const byKey = new Map<string, Throttled<[V]>>();
  return (key: string, value: V) => {
    let t = byKey.get(key);
    if (!t) {
      t = throttle((v: V) => fn(key, v), ms);
      byKey.set(key, t);
    }
    t(value);
  };
}
