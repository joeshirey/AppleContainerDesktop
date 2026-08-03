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

  // There was a Builder entry here for managing the BuildKit VM. It read as
  // "the place you build images" and sent people looking for the Dockerfile
  // form, which lives under Images. Building an image no longer needs it: the
  // build dialog checks the VM and offers to start it inline.
  it("offers no Builder entry", () => {
    render(<Sidebar active="containers" onSelect={() => {}} />);
    expect(screen.queryByText("Builder")).not.toBeInTheDocument();
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
