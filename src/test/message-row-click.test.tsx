import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Clicking anywhere on a message row, not only its text, must open that email.
async function renderApp() {
  vi.resetModules();
  localStorage.clear();
  delete (window as any).lockboxMailboxes;
  // @ts-expect-error App.jsx is plain JavaScript
  const { default: App } = await import("../cypht/App.jsx");
  return render(<App />);
}

function subjectOf(row: Element) {
  return row.querySelector(".subject-cell .subject-label")?.textContent?.trim();
}

describe("message list row click", () => {
  it("opens the email when the empty part of the row is clicked", async () => {
    const { container } = await renderApp();
    const row = container.querySelector("tr.message-row") as HTMLElement;
    const subject = subjectOf(row);
    expect(subject).toBeTruthy();

    fireEvent.click(row.querySelector("td.source-cell") as HTMLElement);

    expect(container.querySelector(".message-reader h2")?.textContent?.trim()).toBe(subject);
  });

  it("keeps the checkbox and flag controls from opening the email", async () => {
    const { container } = await renderApp();
    const row = container.querySelector("tr.message-row") as HTMLElement;

    fireEvent.click(row.querySelector("td.checkbox-cell input") as HTMLElement);
    fireEvent.click(row.querySelector("td.flag-cell button") as HTMLElement);

    expect(container.querySelector(".message-reader h2")).toBeNull();
    expect(container.querySelector(".bulk-toolbar")).not.toBeNull();
  });
});
