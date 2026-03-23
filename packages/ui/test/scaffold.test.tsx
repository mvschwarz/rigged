import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../src/App.js";

describe("App", () => {
  it("renders without crash", () => {
    render(<App />);
    expect(screen.getByText("Rigged")).toBeDefined();
  });
});
