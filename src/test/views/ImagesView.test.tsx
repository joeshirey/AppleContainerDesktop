import { describe, it, expect, vi, beforeEach } from "vitest";
import { act as reactAct, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImagesView } from "../../views/ImagesView";

vi.mock("../../api", () => ({
  listImages: vi.fn(),
  removeImage: vi.fn(),
  pruneImages: vi.fn(),
  runContainer: vi.fn(),
  getBuildState: vi.fn(),
}));
vi.mock("../../panels/PullModal", () => ({
  PullModal: ({ onClose }: any) => (
    <div data-testid="pull-modal">
      <button onClick={onClose}>close-pull</button>
    </div>
  ),
}));
vi.mock("../../panels/RunModal", () => ({
  RunModal: ({ defaultImage, onClose }: any) => (
    <div data-testid="run-modal">
      <span data-testid="run-image">{defaultImage}</span>
      <button onClick={onClose}>close-run</button>
    </div>
  ),
}));
vi.mock("../../panels/BuildModal", () => ({
  BuildModal: ({ onClose }: any) => (
    <div data-testid="build-modal">
      <button onClick={onClose}>close-build</button>
    </div>
  ),
}));
vi.mock("../../hooks/useBuild", async () => {
  const actual = await vi.importActual<typeof import("../../hooks/useBuild")>("../../hooks/useBuild");
  return { ...actual, useBuild: () => ({ build: mockBuild, refresh: async () => {} }) };
});

let mockBuild = { buildId: 0, status: "idle", tag: "", exitCode: null, lines: [], nextSeq: 0, dropped: 0 };

import { listImages, removeImage, pruneImages } from "../../api";
const mockList = vi.mocked(listImages);
const mockRemove = vi.mocked(removeImage);
const mockPrune = vi.mocked(pruneImages);

const IMAGES = [
  { id: "sha256:abc", reference: "docker.io/library/nginx:latest", repository: "nginx", tag: "latest", size: "187 MB", created: "2026-01-01T00:00:00Z" },
  { id: "sha256:def", reference: "docker.io/library/postgres:16", repository: "postgres", tag: "16", size: "432 MB", created: "2026-01-01T00:00:00Z" },
];

describe("ImagesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuild = { buildId: 0, status: "idle", tag: "", exitCode: null, lines: [], nextSeq: 0, dropped: 0 };
    mockList.mockResolvedValue(IMAGES);
    mockRemove.mockResolvedValue(undefined);
    mockPrune.mockResolvedValue(undefined);
  });

  it("renders table with images after loading", async () => {
    render(<ImagesView />);
    await waitFor(() => expect(screen.getByText("nginx")).toBeInTheDocument());
    expect(screen.getByText("latest")).toBeInTheDocument();
    expect(screen.getByText("187 MB")).toBeInTheDocument();
    expect(screen.getByText("postgres")).toBeInTheDocument();
  });

  it("shows Pull Image button that opens PullModal", async () => {
    render(<ImagesView />);
    await waitFor(() => screen.getByText("nginx"));
    await userEvent.click(screen.getByText("Pull Image…"));
    expect(screen.getByTestId("pull-modal")).toBeInTheDocument();
    await userEvent.click(screen.getByText("close-pull"));
    expect(screen.queryByTestId("pull-modal")).not.toBeInTheDocument();
  });

  it("shows Prune Unused confirmation and calls pruneImages on confirm", async () => {
    render(<ImagesView />);
    await waitFor(() => screen.getByText("nginx"));
    await userEvent.click(screen.getByText("Prune Unused"));
    expect(screen.getByText(/confirm/i)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Confirm Prune"));
    await waitFor(() => expect(mockPrune).toHaveBeenCalled());
  });

  it("shows Run modal prefilled with the full image reference on Run click", async () => {
    render(<ImagesView />);
    await waitFor(() => screen.getByText("nginx"));
    const runBtns = screen.getAllByText("Run");
    await userEvent.click(runBtns[0]);
    expect(screen.getByTestId("run-modal")).toBeInTheDocument();
    expect(screen.getByTestId("run-image")).toHaveTextContent("docker.io/library/nginx:latest");
  });

  // Regression: the view used to pass img.id, and `container image delete`
  // rejects a digest with "failed to delete one or more images".
  it("removes by image reference rather than by digest", async () => {
    render(<ImagesView />);
    await waitFor(() => screen.getByText("nginx"));
    const removeBtns = screen.getAllByText("Remove");
    await userEvent.click(removeBtns[0]);
    expect(screen.getByText("Confirm Remove")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Confirm Remove"));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith("docker.io/library/nginx:latest"));
  });

  // N6: assert the modal is absent before the click so initialising showBuild
  // to true cannot survive undetected.
  it("opens the build modal", async () => {
    mockList.mockResolvedValue([]);
    render(<ImagesView />);
    const btn = await screen.findByRole("button", { name: "Build Image…" });
    expect(screen.queryByTestId("build-modal")).not.toBeInTheDocument();
    await userEvent.click(btn);
    expect(screen.getByTestId("build-modal")).toBeInTheDocument();
  });

  it("closes the build modal when onClose fires", async () => {
    mockList.mockResolvedValue([]);
    render(<ImagesView />);
    await userEvent.click(await screen.findByRole("button", { name: "Build Image…" }));
    expect(screen.getByTestId("build-modal")).toBeInTheDocument();
    await userEvent.click(screen.getByText("close-build"));
    expect(screen.queryByTestId("build-modal")).not.toBeInTheDocument();
  });

  // N1+N2: use a distinctive tag and match the full accessible name with the
  // updated label ("View output", not "click to view output").
  // The point of letting a build detach is being able to get back to it.
  it("shows a strip while a build is in flight and reopens the modal", async () => {
    mockBuild = { ...mockBuild, status: "running", tag: "myrepo/myapp:rc1" } as any;
    mockList.mockResolvedValue([]);
    render(<ImagesView />);
    await userEvent.click(await screen.findByRole("button", { name: "Building myrepo/myapp:rc1… View output" }));
    expect(screen.getByTestId("build-modal")).toBeInTheDocument();
  });

  // N3: a build-output event can arrive before the modal's snapshot resolves,
  // leaving build.tag as "" for a short window. Render "image" as fallback.
  it("shows 'image' when the strip renders before the tag is known", async () => {
    mockBuild = { ...mockBuild, status: "running", tag: "" } as any;
    mockList.mockResolvedValue([]);
    render(<ImagesView />);
    expect(await screen.findByRole("button", { name: "Building image… View output" })).toBeInTheDocument();
  });

  // I4: the strip must be absent for every non-running terminal status, not
  // just idle. A latched "succeeded" would leave "Building…" on-screen for
  // the rest of the session.
  it.each(["idle", "succeeded", "failed", "cancelled"])(
    "hides the strip when build status is %s",
    async (status) => {
      mockBuild = { ...mockBuild, status } as any;
      mockList.mockResolvedValue([]);
      render(<ImagesView />);
      await screen.findByText("No images found.");
      expect(screen.queryByRole("button", { name: /Building/ })).not.toBeInTheDocument();
    },
  );

  // I2: when the view mounts while the session-latched status is already
  // "succeeded", the build-success effect must not fire a second listImages
  // call on top of the mount fetch. refreshedFor is seeded from build.buildId
  // at construction time exactly to prevent this.
  it("does not double-fetch on mount when last build already succeeded", async () => {
    mockBuild = { buildId: 5, status: "succeeded", tag: "old:v1", exitCode: 0, lines: [], nextSeq: 0, dropped: 0 } as any;
    mockList.mockResolvedValue([]);
    render(<ImagesView />);
    await screen.findByText("No images found.");
    // Allow any pending microtasks to flush, then check the count.
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  // I3: assert the new image appears in the DOM, not just that listImages was
  // called. A bare call that discards the result would otherwise leave the
  // tests green.
  it("refreshes the list when a build succeeds", async () => {
    mockList.mockResolvedValue([]);
    const { rerender } = render(<ImagesView />);
    await screen.findByText("No images found.");
    mockList.mockResolvedValue([
      { id: "sha256:new", reference: "myrepo/built:v1", repository: "myrepo/built", tag: "v1", size: "10 MB", created: "2026-01-02T00:00:00Z" },
    ]);
    mockBuild = { buildId: 1, status: "succeeded", tag: "myrepo/built:v1", exitCode: 0, lines: [], nextSeq: 0, dropped: 0 } as any;
    rerender(<ImagesView />);
    await screen.findByText("myrepo/built");
  });

  // M5: the build-success effect must not fire for non-succeeded statuses.
  // If the status guard is removed the effect fires on every mount regardless
  // of status, causing an extra listImages call.
  it("does not call listImages more than once on idle mount", async () => {
    let callCount = 0;
    mockList.mockImplementation(() => { callCount++; return Promise.resolve([]); });
    render(<ImagesView />);
    await screen.findByText("No images found.");
    expect(callCount).toBe(1);
  });

  // M7: build.status must be in the effect dependency array. If it is omitted,
  // a build that transitions running → succeeded with the same buildId never
  // triggers a refresh because buildId did not change.
  it("refreshes the list when status changes from running to succeeded (same buildId)", async () => {
    mockBuild = { buildId: 1, status: "running", tag: "myapp:v1", exitCode: null, lines: [], nextSeq: 0, dropped: 0 } as any;
    mockList.mockResolvedValue([]);
    const { rerender } = render(<ImagesView />);
    await screen.findByText("No images found.");
    mockList.mockResolvedValue([
      { id: "sha256:new", reference: "myapp:v1", repository: "myapp", tag: "v1", size: "10 MB", created: "2026-01-02T00:00:00Z" },
    ]);
    mockBuild = { buildId: 1, status: "succeeded", tag: "myapp:v1", exitCode: 0, lines: [], nextSeq: 0, dropped: 0 } as any;
    rerender(<ImagesView />);
    await screen.findByText("myapp");
  });

  // M13: the token check before setImages must be present. Without it, a stale
  // mount response that arrives after the build-success refresh has landed would
  // overwrite the new image data with the pre-build list.
  it("ignores a stale listImages response superseded by the build-success refresh", async () => {
    let resolveMount!: (imgs: any[]) => void;
    let callCount = 0;
    mockList.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Mount's request is intentionally slow.
        return new Promise<any[]>(r => { resolveMount = r; });
      }
      // Build-success refresh resolves quickly with the newly-built image.
      return Promise.resolve([
        { id: "sha256:new", reference: "myapp:v1", repository: "myapp", tag: "v1", size: "10 MB", created: "2026-01-02T00:00:00Z" },
      ]);
    });
    const { rerender } = render(<ImagesView />);
    // Mount's fetch is pending — loading indicator still showing.
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    // Build succeeds while the mount fetch is still in flight.
    mockBuild = { buildId: 1, status: "succeeded", tag: "myapp:v1", exitCode: 0, lines: [], nextSeq: 0, dropped: 0 } as any;
    rerender(<ImagesView />);
    // Fast build-success refresh resolves — myapp appears.
    await screen.findByText("myapp");
    // Stale mount response arrives carrying the old pre-build list. Must be
    // ignored: myapp must remain visible.
    await reactAct(async () => { resolveMount(IMAGES); });
    expect(screen.getByText("myapp")).toBeInTheDocument();
    expect(screen.queryByText("nginx")).not.toBeInTheDocument();
  });

  // M14: the token check before setError must be present. Without it, a stale
  // mount rejection that arrives after a successful refresh would push a
  // misleading error banner onto the updated view.
  it("ignores a stale listImages rejection superseded by the build-success refresh", async () => {
    let rejectMount!: (e: Error) => void;
    let callCount = 0;
    mockList.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Mount's request will reject late.
        return new Promise<any[]>((_, reject) => { rejectMount = reject; });
      }
      return Promise.resolve([
        { id: "sha256:new", reference: "myapp:v1", repository: "myapp", tag: "v1", size: "10 MB", created: "2026-01-02T00:00:00Z" },
      ]);
    });
    const { rerender } = render(<ImagesView />);
    mockBuild = { buildId: 1, status: "succeeded", tag: "myapp:v1", exitCode: 0, lines: [], nextSeq: 0, dropped: 0 } as any;
    rerender(<ImagesView />);
    await screen.findByText("myapp");
    // Stale mount request rejects — must not push an error banner.
    await reactAct(async () => { rejectMount(new Error("network down")); });
    expect(screen.queryByText("network down")).not.toBeInTheDocument();
  });

  // I3 + buildId dep: two consecutive builds both succeed. The second must
  // also refresh even though the status string does not change between them.
  // The new image from the second build must appear in the DOM.
  it("refreshes once per build success, not once per status value", async () => {
    mockList.mockResolvedValue([]);
    const { rerender } = render(<ImagesView />);
    await screen.findByText("No images found.");

    // First build succeeds — its image appears.
    mockList.mockResolvedValue([
      { id: "sha256:b1", reference: "app:v1", repository: "app", tag: "v1", size: "10 MB", created: "2026-01-02T00:00:00Z" },
    ]);
    mockBuild = { buildId: 1, status: "succeeded", tag: "app:v1", exitCode: 0, lines: [], nextSeq: 0, dropped: 0 } as any;
    rerender(<ImagesView />);
    await screen.findByText("app");

    // Second build succeeds — its distinct image must also appear.
    mockList.mockResolvedValue([
      { id: "sha256:b2", reference: "svc:v2", repository: "svc", tag: "v2", size: "12 MB", created: "2026-01-03T00:00:00Z" },
    ]);
    mockBuild = { buildId: 2, status: "succeeded", tag: "svc:v2", exitCode: 0, lines: [], nextSeq: 0, dropped: 0 } as any;
    rerender(<ImagesView />);
    await screen.findByText("svc");
  });
});
