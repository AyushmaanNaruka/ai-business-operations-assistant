/**
 * Races `promise` against a timer. If the timer fires first, calls `onTimeout`
 * (used to `connection.interrupt()` a running query) and resolves to the
 * `'TIMEOUT'` sentinel instead of rejecting, so callers branch on the return
 * value rather than a thrown exception. Isolated from DuckDB so it can be
 * tested with a controlled, never-resolving promise instead of an actually
 * slow query.
 */
export async function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => void,
): Promise<T | 'TIMEOUT'> {
  return new Promise<T | 'TIMEOUT'>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      resolve('TIMEOUT');
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
