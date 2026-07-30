import { render, screen, fireEvent } from "@testing-library/react";
import { SystemBanner } from "../../components/SystemBanner";

describe("SystemBanner", () => {
  it("reports the running state and offers to stop it", () => {
    render(<SystemBanner running={true} onStart={() => {}} onStop={() => {}} />);
    expect(screen.getByText(/container system is running/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop Containers" })).toBeInTheDocument();
  });

  it("reports the stopped state and offers to start it", () => {
    render(<SystemBanner running={false} onStart={() => {}} onStop={() => {}} />);
    expect(screen.getByText(/container system is not running/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Containers" })).toBeInTheDocument();
  });

  it("calls onStart on button click", () => {
    const fn = vi.fn();
    render(<SystemBanner running={false} onStart={fn} onStop={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Start Containers" }));
    expect(fn).toHaveBeenCalled();
  });

  it("calls onStop on button click", () => {
    const fn = vi.fn();
    render(<SystemBanner running={true} onStart={() => {}} onStop={fn} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop Containers" }));
    expect(fn).toHaveBeenCalled();
  });
});
