import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
// @ts-expect-error - original JavaScript source has no type declarations
import AiDefaults from "@/cypht/AiDefaults.jsx";
// @ts-expect-error - original JavaScript source has no type declarations
import { freshDefaults } from "@/cypht/privacy.js";

describe("hide-by-default automatic saving", () => {
  it("applies an unlocked visibility change without a separate save action", () => {
    const onSave = vi.fn();
    render(<AiDefaults value={freshDefaults()} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "Change settings" }));
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: "Lock" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("switch", { name: "Subject (header)" }));

    expect(onSave).toHaveBeenCalledWith({ ...freshDefaults(), subject: false });
  });
});
