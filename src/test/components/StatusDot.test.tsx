import { render, screen } from "@testing-library/react";
import { StatusDot } from "../../components/StatusDot";

describe("StatusDot", () => {
  it("is green for running", () => {
    render(<StatusDot status="running" />);
    expect(screen.getByTestId("dot")).toHaveStyle("background-color: #34c759");
  });
  it("is gray for stopped", () => {
    render(<StatusDot status="stopped" />);
    expect(screen.getByTestId("dot")).toHaveStyle("background-color: #8e8e93");
  });
});
