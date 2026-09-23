// Pure display formatters shared by components (Dropzone file size, job trace
// timestamps). Kept dependency-free and unit-tested.

function byteUnit(exponent: number): string {
  switch (exponent) {
    case 1:
      return 'KB';
    case 2:
      return 'MB';
    case 3:
      return 'GB';
    default:
      return 'B';
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  const value = bytes / 1024 ** exponent;
  const precision = exponent === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${byteUnit(exponent)}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Formats an ISO-8601 timestamp as a short relative age, e.g. "3s ago". */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Math.max(0, now.getTime() - then);
  if (diffMs < 5_000) return 'just now';
  if (diffMs < MINUTE_MS) return `${Math.floor(diffMs / 1_000)}s ago`;
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}m ago`;
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}h ago`;
  return `${Math.floor(diffMs / DAY_MS)}d ago`;
}
