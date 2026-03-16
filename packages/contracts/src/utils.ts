/**
 * Strip keys whose value is `undefined` so that objects parsed by Zod
 * (which infers `T | undefined` for `.optional()` fields) satisfy
 * TypeScript's `exactOptionalPropertyTypes`.
 *
 * The return type removes `undefined` from every value type.  Keys that
 * were `undefined` are absent from the result object at runtime.
 */
export function stripUndefined<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value;
  }
  return result as { [K in keyof T]: Exclude<T[K], undefined> };
}
