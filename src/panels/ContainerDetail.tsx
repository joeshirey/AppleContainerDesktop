import type { Container } from "../types";
export function ContainerDetail({ container, onAction }: { container: Container; onAction?: () => void }) {
  return <div style={{ padding: 16, color: "#8e8e93" }}>{container.name} detail — Task 7</div>;
}
