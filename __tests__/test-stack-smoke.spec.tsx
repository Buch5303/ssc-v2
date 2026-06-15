/**
 * Smoke test for the accessibility/interaction test stack (added 2026-06-15).
 * Proves jsdom + @testing-library/react + jest-dom matchers + jest-axe are
 * wired correctly, so directive-generated component/a11y tests can run. If
 * this fails, the test toolchain regressed — not a product bug.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

function Sample() {
  return (
    <main>
      <h1>FlowSeer</h1>
      <button type="button">Run audit</button>
    </main>
  );
}

describe("test stack smoke", () => {
  it("renders into the jsdom document", () => {
    render(<Sample />);
    expect(screen.getByRole("button", { name: /run audit/i })).toBeInTheDocument();
  });

  it("reports no accessibility violations", async () => {
    const { container } = render(<Sample />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
