import { addDays, startOfDay } from "@/lib/span-layout";
import type { Span } from "@/lib/tauri";

const CATEGORY_COLORS: Record<string, string> = {
  cycling: "#59d499",
  ride: "#59d499",
  walking: "#8bd5a8",
  running: "#8bd5a8",
  driving: "#63a1ff",
  travel: "#63a1ff",
  commute: "#63a1ff",
  visit: "#c792ea",
  appointment: "#c792ea",
  meeting: "#56c2ff",
  call: "#56c2ff",
  reminder: "#56c2ff",
  expense: "#ffb454",
  payment: "#ffb454",
  delivery: "#ffb454",
  meal: "#ff9e64",
  food: "#ff9e64",
  todo: "#e6e6e6",
};
const FALLBACK_COLORS = ["#9c9c9d", "#7fdbca", "#f78c6c", "#82aaff", "#c3e88d"];

export function categoryColor(category: string): string {
  const known = CATEGORY_COLORS[category.toLowerCase()];
  if (known) return known;
  let hash = 0;
  for (const ch of category) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatMoney(amount: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function formatAmount(span: Span): string | null {
  const amount = span.data?.amount;
  if (typeof amount !== "number") return null;
  return formatMoney(
    amount,
    typeof span.data?.currency === "string" ? span.data.currency : "INR",
  );
}

export function daysFrom(start: Date, count: number): Date[] {
  const first = startOfDay(start);
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}
