import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "../../components/Sidebar";

describe("Sidebar", () => {
  it("renders all nav items", () => {
    render(<Sidebar active="containers" onSelect={() => {}} />);
    expect(screen.getByText("Containers")).toBeInTheDocument();
    expect(screen.getByText("Images")).toBeInTheDocument();
    expect(screen.getByText("Hub Search")).toBeInTheDocument();
    expect(screen.getByText("Machines")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("calls onSelect with the section key", () => {
    const fn = vi.fn();
    render(<Sidebar active="containers" onSelect={fn} />);
    fireEvent.click(screen.getByText("Images"));
    expect(fn).toHaveBeenCalledWith("images");
  });

  it("marks the active item with data-active", () => {
    render(<Sidebar active="images" onSelect={() => {}} />);
    expect(screen.getByText("Images").closest("[data-active]")).toBeTruthy();
  });
});
