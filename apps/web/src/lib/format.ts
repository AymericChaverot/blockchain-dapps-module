export function shortHex(value: string, chars = 4): string {
  if (value.length <= 2 + chars * 2) return value;
  return `${value.slice(0, 2 + chars)}…${value.slice(-chars)}`;
}

export function fromUnix(seconds: bigint | number): Date {
  return new Date(Number(seconds) * 1000);
}

export function formatDate(seconds: bigint | number): string {
  return fromUnix(seconds).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(seconds: bigint | number): string {
  return fromUnix(seconds).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "in 3 days", "2 hours ago"... */
export function relativeTime(seconds: bigint | number, now: number = Date.now()): string {
  const diff = Number(seconds) * 1000 - now;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 86_400_000],
    ["month", 30 * 86_400_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1000],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of units) {
    if (Math.abs(diff) >= ms || unit === "second") return formatter.format(Math.round(diff / ms), unit);
  }
  return "";
}

/** yyyy-mm-dd for <input type="date"> */
export function toDateInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

export function downloadTextFile(fileName: string, content: string, mime = "application/json"): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
