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

  // `running` is null until the first status check comes back. Claiming either
  // state before then means showing a green "running" banner on a machine where
  // the system is stopped, and then swapping it out a moment later.
  it("commits to neither state while the status is still unknown", () => {
    render(<SystemBanner running={null} onStart={() => {}} onStop={() => {}} />);
    expect(screen.getByText(/checking container system/i)).toBeInTheDocument();
    expect(screen.queryByText(/container system is running/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/container system is not running/i)).not.toBeInTheDocument();
  });

  it("offers no button to press while the status is unknown", () => {
    render(<SystemBanner running={null} onStart={() => {}} onStop={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a failure reason alongside the banner", () => {
    render(
      <SystemBanner
        running={false}
        error="launchd refused to load the service"
        onStart={() => {}}
        onStop={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("launchd refused to load the service");
    // The banner itself still works — the error sits alongside it, not instead of it.
    expect(screen.getByRole("button", { name: "Start Containers" })).toBeInTheDocument();
  });

  it("renders no alert when there is no error", () => {
    render(<SystemBanner running={true} onStart={() => {}} onStop={() => {}} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
