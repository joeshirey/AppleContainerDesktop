import { describe, expect, it } from "vitest";
import { displayStats } from "../../lib/stats";
import stats from "../fixtures/container-1.4.1/stats.json";

describe("1.4.1 resource counters", () => {
  it("shows memory from a real sample without inventing a CPU percentage", () => {
    const result = displayStats({ stats: stats[0], time: 1000 });
    expect(result.memory).toBe("3.78 MiB / 512.00 MiB");
    expect(result.cpu).toBeUndefined();
  });

  it("calculates CPU across samples and allows more than one full core", () => {
    const previous = { stats: { cpuUsageUsec: 1000 }, time: 1000 };
    expect(displayStats({ stats: { cpuUsageUsec: 3_001_000 }, time: 3000 }, previous).cpu).toBe("150.00%");
  });

  it("does not report a negative rate when a container restarts", () => {
    expect(displayStats({ stats: { cpuUsageUsec: 10 }, time: 3000 }, {
      stats: { cpuUsageUsec: 1000 }, time: 1000,
    }).cpu).toBeUndefined();
  });

  it("handles absent samples, zero memory, and legacy formatted values", () => {
    expect(displayStats({ stats: {}, time: 1 })).toEqual({});
    expect(displayStats({ stats: { memoryUsageBytes: 0 }, time: 1 }).memory).toBe("0.00 KiB");
    expect(displayStats({ stats: { cpu: "1%", memory: "48 MB" }, time: 1 })).toEqual({ cpu: "1%", memory: "48 MB" });
  });
});
