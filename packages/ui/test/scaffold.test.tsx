import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../src/App.js";

describe("App", () => {
  it("renders without crash", () => {
    render(<App />);
    // App renders RigGraph with rigId=null -> "No rig selected"
    expect(screen.getByText(/no rig selected/i)).toBeDefined();
  });
});
