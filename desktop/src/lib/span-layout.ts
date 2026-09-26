import type { Span } from "@/lib/tauri";

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;
export const MIN_BLOCK_MINUTES = 25;
const CHILD_HEADER_MINUTES = 22;

export type PlacedSpan = {
  span: Span;
  top: number;
  height: number;
  left: number;
  width: number;
  depth: number;
  instant: boolean;
};

type Node = {
  span: Span;
  start: number;
  end: number;
  instant: boolean;
  children: Node[];
};

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function bounds(span: Span): [number, number] | null {
  if (!span.start_at) return null;
  const start = new Date(span.start_at).getTime();
  const end = span.end_at ? new Date(span.end_at).getTime() : start;
  return [start, Math.max(start, end)];
}

export function isAllDay(span: Span): boolean {
  const b = bounds(span);
  return !!b && b[1] - b[0] >= DAY_MINUTES * MINUTE;
}

function pack(
  nodes: Node[],
  left: number,
  width: number,
  depth: number,
  out: PlacedSpan[],
) {
  const sorted = [...nodes].sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: { node: Node; col: number }[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const cols = columnEnds.length;
    for (const { node, col } of cluster) {
      const w = width / cols;
      const l = left + col * w;
      out.push({
        span: node.span,
        top: node.start,
        height: node.end - node.start,
        left: l,
        width: w,
        depth,
        instant: node.instant,
      });
      for (const child of node.children) {
        child.start = Math.max(child.start, node.start + CHILD_HEADER_MINUTES);
        child.end = Math.max(child.end, child.start + MIN_BLOCK_MINUTES);
      }
      pack(node.children, l, w, depth + 1, out);
    }
    cluster = [];
    columnEnds = [];
  };

  for (const node of sorted) {
    if (node.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let col = columnEnds.findIndex((end) => end <= node.start);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(node.end);
    } else {
      columnEnds[col] = node.end;
    }
    cluster.push({ node, col });
    clusterEnd = Math.max(clusterEnd, node.end);
  }
  flush();
}

export function layoutDay(spans: Span[], day: Date): PlacedSpan[] {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + DAY_MINUTES * MINUTE;
  const nodes = new Map<string, Node>();

  for (const span of spans) {
    const b = bounds(span);
    if (!b || isAllDay(span)) continue;
    const [start, end] = b;
    const instant = end === start;
    if (
      instant
        ? start < dayStart || start >= dayEnd
        : end <= dayStart || start >= dayEnd
    ) {
      continue;
    }
    const s = (Math.max(start, dayStart) - dayStart) / MINUTE;
    const e = (Math.min(end, dayEnd) - dayStart) / MINUTE;
    const top = Math.min(s, DAY_MINUTES - MIN_BLOCK_MINUTES);
    nodes.set(span.id, {
      span,
      start: top,
      end: Math.max(e, top + MIN_BLOCK_MINUTES),
      instant,
      children: [],
    });
  }

  const roots: Node[] = [];
  for (const node of nodes.values()) {
    const parent = node.span.parent_id
      ? nodes.get(node.span.parent_id)
      : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  const out: PlacedSpan[] = [];
  pack(roots, 0, 1, 0, out);
  return out;
}

export type AllDayRow = {
  span: Span;
  startCol: number;
  endCol: number;
  row: number;
};

export function layoutAllDay(spans: Span[], days: Date[]): AllDayRow[] {
  if (days.length === 0) return [];
  const first = startOfDay(days[0]).getTime();
  const dayMs = DAY_MINUTES * MINUTE;
  const rowEnds: number[] = [];
  const out: AllDayRow[] = [];
  const items = spans
    .filter(isAllDay)
    .map((span) => {
      const [start, end] = bounds(span)!;
      return {
        span,
        startCol: Math.max(0, Math.floor((start - first) / dayMs)),
        endCol: Math.min(
          days.length - 1,
          Math.floor((end - 1 - first) / dayMs),
        ),
      };
    })
    .filter(
      (i) =>
        i.endCol >= 0 && i.startCol < days.length && i.startCol <= i.endCol,
    )
    .sort((a, b) => a.startCol - b.startCol);

  for (const item of items) {
    let row = rowEnds.findIndex((end) => end < item.startCol);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(item.endCol);
    } else {
      rowEnds[row] = item.endCol;
    }
    out.push({ ...item, row });
  }
  return out;
}
