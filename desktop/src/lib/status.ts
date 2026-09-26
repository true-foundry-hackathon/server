export function statusLabel(state: string, error: string) {
  if (error) return error;
  switch (state) {
    case "connecting":
      return "Connecting…";
    case "active":
      return "Live Duplex Voice";
    case "ended":
      return "Session ended";
    default:
      return "Ready to Talk";
  }
}

export function statusBadgeVariant(status: string) {
  switch (status) {
    case "completed":
      return "default" as const;
    case "executing":
    case "failed":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}
