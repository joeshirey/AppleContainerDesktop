const COLOR: Record<string, string> = { running: "#34c759", stopped: "#8e8e93", exited: "#8e8e93", created: "#ff9f0a" };

export function StatusDot({ status }: { status: string }) {
  return <div data-testid="dot" style={{ width: 8, height: 8, borderRadius: "50%", background: COLOR[status.toLowerCase()] ?? "#8e8e93", flexShrink: 0 }} />;
}
