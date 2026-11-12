import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// On a real server or the desktop app, Lockbox must never show the preview's sample mail.
describe("real mail mode", () => {
  it("starts with no sample messages and offers Add mailbox", async () => {
    vi.resetModules();
    localStorage.clear();
    (window as any).lockboxMailboxes = { runtime: "desktop", list: async () => [], providers: async () => ({}) };
    // @ts-expect-error App.jsx is plain JavaScript
    const { default: App } = await import("../cypht/App.jsx");
    render(<App />);
    expect(screen.queryByText("Sarah Chen")).toBeNull();
    expect(await screen.findByText(/Connect Gmail, Outlook or any IMAP email/)).toBeTruthy();
    delete (window as any).lockboxMailboxes;
  });
});
