import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HubSearchView } from "../../views/HubSearchView";

vi.mock("../../api", () => ({
  pullImage: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { pullImage } from "../../api";
const mockPull = vi.mocked(pullImage);

const SEARCH_RESPONSE = {
  results: [
    { name: "nginx", description: "Official Nginx image", star_count: 20000, pull_count: 1200000000, is_official: true },
    { name: "myuser/myapp", description: "A custom app", star_count: 42, pull_count: 1000, is_official: false },
  ],
};

const TAGS_RESPONSE = { results: [{ name: "latest" }, { name: "1.27" }, { name: "alpine" }] };

describe("HubSearchView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPull.mockResolvedValue(undefined);
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("search")) return Promise.resolve({ ok: true, json: () => Promise.resolve(SEARCH_RESPONSE) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(TAGS_RESPONSE) });
    });
  });

  it("renders search input and Search button", () => {
    render(<HubSearchView />);
    expect(screen.getByPlaceholderText(/search docker hub/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
  });

  it("shows results after search", async () => {
    render(<HubSearchView />);
    await userEvent.type(screen.getByPlaceholderText(/search docker hub/i), "nginx");
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() => expect(screen.getByText("nginx")).toBeInTheDocument());
    expect(screen.getByText("Official Nginx image")).toBeInTheDocument();
    expect(screen.getByText("Official")).toBeInTheDocument();
  });

  it("shows empty state when no results", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ results: [] }) });
    render(<HubSearchView />);
    await userEvent.type(screen.getByPlaceholderText(/search docker hub/i), "xyzzy");
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() => expect(screen.getByText(/no results/i)).toBeInTheDocument());
  });

  it("calls pullImage when Pull is clicked on a result", async () => {
    render(<HubSearchView />);
    await userEvent.type(screen.getByPlaceholderText(/search docker hub/i), "nginx");
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() => screen.getAllByText("Pull")[0]);
    await userEvent.click(screen.getAllByText("Pull")[0]);
    await waitFor(() => expect(mockPull).toHaveBeenCalled());
  });

  it("submits search on Enter key", async () => {
    render(<HubSearchView />);
    await userEvent.type(screen.getByPlaceholderText(/search docker hub/i), "nginx{Enter}");
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  });
});
