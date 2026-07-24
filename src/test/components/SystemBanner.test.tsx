import { render, screen, fireEvent } from "@testing-library/react";
import { SystemBanner } from "../../components/SystemBanner";

describe("SystemBanner", () => {
  it("renders nothing when running=true", () => {
    render(<SystemBanner running={true} onStart={() => {}} />);
    expect(screen.queryByText(/not running/i)).not.toBeInTheDocument();
  });

  it("renders banner when running=false", () => {
    render(<SystemBanner running={false} onStart={() => {}} />);
    expect(screen.getByText(/container system is not running/i)).toBeInTheDocument();
  });

  it("calls onStart on button click", () => {
    const fn = vi.fn();
    render(<SystemBanner running={false} onStart={fn} />);
    fireEvent.click(screen.getByRole("button", { name: /start system/i }));
    expect(fn).toHaveBeenCalled();
  });
});
