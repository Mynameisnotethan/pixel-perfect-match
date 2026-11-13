import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prefix = "lockbox-live:v1:";
const completeMessage = {
  id: "google:owner@example.com:1", account: "google:owner@example.com", folder: "inbox",
  sender: "Sender", email: "sender@example.com", subject: "Complete encrypted message",
  body: "Every line remains\nincluding this one", bodyHtml: "<p>Every <strong>line</strong> remains</p>",
  date: "2026-11-13T00:00:00Z", read: false, flagged: false, reviewed: true,
  attachments: [{ name: "original.pdf", content: "data:application/pdf;base64,AAECAwQ=", size: 5 }],
};

function bridge(saved: Record<string, unknown>) {
  const data = new Map(Object.entries(saved));
  const removed: string[][] = [];
  return {
    runtime: "desktop", list: async () => [],
    privacy: { get: async () => null, put: async () => {} },
    store: {
      get: async (key: string, fallback?: unknown) => data.has(key) ? structuredClone(data.get(key)) : fallback,
      put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); },
      remove: async (keys: string[]) => { removed.push(keys); keys.forEach(key => data.delete(key)); },
    },
    data, removed,
  };
}

describe("desktop encrypted storage integration", () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); delete (window as any).lockboxMailboxes; });

  it("loads complete messages through the secure bridge, migrates plaintext, and supports online-only mode", async () => {
    localStorage.setItem(prefix + "messages", JSON.stringify([completeMessage]));
    const mock = bridge({});
    (window as any).lockboxMailboxes = mock;
    // @ts-expect-error App.jsx is plain JavaScript
    const { default: App } = await import("../cypht/App.jsx");
    const first = render(<App />);
    await waitFor(() => expect(mock.data.get(prefix + "messages")).toEqual([completeMessage]));
    expect(await screen.findByText("Complete encrypted message")).toBeTruthy();
    expect(localStorage.getItem(prefix + "messages")).toBeNull();
    expect(localStorage.getItem(prefix + "settings")).toBeNull();

    fireEvent.click(screen.getByTitle("Settings"));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Online-only email/ }));
    await waitFor(() => expect((mock.data.get(prefix + "settings") as any).onlineOnly).toBe(true));
    await waitFor(() => expect(mock.data.has(prefix + "messages")).toBe(false));
    expect(mock.data.has(prefix + "open-drafts")).toBe(false);
    expect(mock.data.has(prefix + "pending-sends")).toBe(false);
    first.unmount();

    render(<App />);
    await waitFor(() => expect(mock.data.get(prefix + "settings")).toBeTruthy());
    expect(screen.queryByText("Complete encrypted message")).toBeNull();
    delete (window as any).lockboxMailboxes;
  });
});
