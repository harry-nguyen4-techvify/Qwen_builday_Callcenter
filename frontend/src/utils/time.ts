/**
 * Parse a server-provided timestamp. Backend returns naive UTC strings
 * like "2026-04-16T17:15:48" (no Z). Without a Z, `new Date(...)` treats
 * them as LOCAL time — causing a timezone offset (e.g. +7h in VN).
 * Append 'Z' when no timezone marker is present so it's parsed as UTC.
 */
export function parseServerTime(ts: string | null | undefined): number {
  if (!ts) return 0
  const hasTZ = /([zZ]|[+-]\d{2}:?\d{2})$/.test(ts)
  return new Date(hasTZ ? ts : ts + 'Z').getTime()
}
