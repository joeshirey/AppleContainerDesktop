import type { ContainerStats } from "../types";

export interface StatsSample {
  stats: ContainerStats;
  time: number;
}

function bytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MiB`;
  return `${(value / 1024).toFixed(2)} KiB`;
}

/// JSON contains cumulative CPU microseconds, not a percentage. Match the
/// CLI's convention: 100% means one fully occupied core.
export function displayStats(current: StatsSample, previous?: StatsSample): ContainerStats {
  const { stats, time } = current;
  let cpu = stats.cpu;
  const usage = stats.cpuUsageUsec;
  const oldUsage = previous?.stats.cpuUsageUsec;
  if (usage !== undefined && oldUsage !== undefined && previous && time > previous.time && usage >= oldUsage) {
    cpu = `${((usage - oldUsage) / ((time - previous.time) * 10)).toFixed(2)}%`;
  }
  let memory = stats.memory;
  if (stats.memoryUsageBytes !== undefined) {
    memory = bytes(stats.memoryUsageBytes);
    if (stats.memoryLimitBytes !== undefined) memory += ` / ${bytes(stats.memoryLimitBytes)}`;
  }
  return { ...stats, cpu, memory };
}
