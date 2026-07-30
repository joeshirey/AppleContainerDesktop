import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HubSearchView } from "../../views/HubSearchView";

vi.mock("../../api", () => ({
  pullImage: vi.fn(),
  searchHub: vi.fn(),
  getHubTags: vi.fn(),
}));

import { pullImage, searchHub, getHubTags } from "../../api";
const mockPull = vi.mocked(pullImage);
const mockSearch = vi.mocked(searchHub);
const mockTags = vi.mocked(getHubTags);

// searchHub normalizes and sorts; the view receives a plain HubResult[].
const SEARCH_RESPONSE = [
  { name: "library/nginx", displayName: "nginx", description: "Official Nginx image", isOfficial: true, pullCount: 1200000000, starCount: 20000 },
  { name: "myuser/myapp", displayName: "myuser/myapp", description: "A custom app", isOfficial: false, pullCount: 1000, starCount: 42 },
];

const TAGS_RESPONSE = { results: [{ name: "latest" }, { name: "1.27" }, { name: "alpine" }] };

describe("HubSearchView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPull.mockResolvedValue(undefined);
    mockSearch.mockResolvedValue(SEARCH_RESPONSE);
    mockTags.mockResolvedValue(TAGS_RESPONSE);
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
    mockSearch.mockResolvedValueOnce([]);
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
    await waitFor(() => expect(mockSearch).toHaveBeenCalled());
  });
});
