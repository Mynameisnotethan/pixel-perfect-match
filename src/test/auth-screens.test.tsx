import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
// @ts-expect-error - original JavaScript source has no type declarations
import { AuthProvider, AuthGate, useAuth } from "@/cypht/AuthScreens.jsx";

/** Installs a fake self-hosted server the way the Docker build's bridge sees one. */
function server(over: Record<string, unknown> = {}) {
  const bridge = {
    runtime: "web",
    session: vi.fn(async () => ({ status: "needs-setup" })),
    setup: vi.fn(async () => ({ status: "needs-login" })),
    login: vi.fn(async () => ({ status: "ok", user: "admin" })),
    logout: vi.fn(async () => null),
    list: vi.fn(async () => []),
    ...over,
  };
  (window as unknown as { lockboxMailboxes: unknown }).lockboxMailboxes = bridge;
  return bridge;
}
const openApp = () => render(<AuthProvider><AuthGate><div data-testid="app">Mail</div></AuthGate></AuthProvider>);

afterEach(() => { delete (window as unknown as { lockboxMailboxes?: unknown }).lockboxMailboxes; });

describe("first-run setup screen", () => {
  it("asks for the code from the logs, creates the administrator, then asks for sign-in", async () => {
    const bridge = server();
    openApp();
    expect(await screen.findByText("Set up Lockbox")).toBeTruthy();
    expect(screen.getByText(/Where do I find the setup code/)).toBeTruthy();
    expect(screen.queryByTestId("app")).toBeNull();

    fireEvent.change(screen.getByLabelText(/Setup code/), { target: { value: "k7mq-2p9x-rw4d" } });
    fireEvent.change(screen.getByLabelText(/Administrator username/), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Create administrator" }));

    expect(await screen.findByText("Sign in to Lockbox")).toBeTruthy();
    expect(bridge.setup).toHaveBeenCalledWith({ code: "k7mq-2p9x-rw4d", username: "owner", password: "correct horse battery" });
    expect(screen.getByText(/Lockbox is set up/)).toBeTruthy();
  });

  it("explains a wrong setup code instead of failing silently", async () => {
    const bridge = server({ setup: vi.fn(async () => { throw new Error("setup_code_incorrect"); }) });
    openApp();
    await screen.findByText("Set up Lockbox");
    fireEvent.change(screen.getByLabelText(/Setup code/), { target: { value: "nope-nope-nope" } });
    fireEvent.change(screen.getByLabelText(/Administrator username/), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Create administrator" }));
    expect(await screen.findByText(/That setup code is not right/)).toBeTruthy();
    expect(bridge.session).toHaveBeenCalledTimes(1);
  });
});

describe("sign-in screen", () => {
  it("signs in and only then shows the app", async () => {
    const bridge = server({ session: vi.fn(async () => ({ status: "needs-login" })) });
    openApp();
    expect(await screen.findByText("Sign in to Lockbox")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByTestId("app")).toBeTruthy();
    expect(bridge.login).toHaveBeenCalledWith("owner", "correct horse battery");
  });

  it("shows a readable message when the credentials do not match", async () => {
    server({
      session: vi.fn(async () => ({ status: "needs-login" })),
      login: vi.fn(async () => { throw new Error("invalid_credentials"); }),
    });
    openApp();
    await screen.findByText("Sign in to Lockbox");
    fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "wrong password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/username and password do not match/)).toBeTruthy();
    expect(screen.queryByTestId("app")).toBeNull();
  });

  it("offers to retry when the server cannot be reached", async () => {
    server({ session: vi.fn(async () => { throw new Error("network down"); }) });
    openApp();
    expect(await screen.findByText(/could not reach its server/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText(/could not reach its server/);
  });
});

describe("sign-out", () => {
  it("removes cached live mail but leaves preview data alone", async () => {
    server({ session: vi.fn(async () => ({ status: "ok", user: "owner" })) });
    localStorage.setItem("lockbox-live:v1:messages", "private");
    localStorage.setItem("cypht-preview:v1:messages", "sample");
    function SignOut() {
      const auth = useAuth();
      return <button onClick={() => auth.signOut()}>Sign out</button>;
    }
    render(<AuthProvider><AuthGate><SignOut /></AuthGate></AuthProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await screen.findByText("Sign in to Lockbox");
    expect(localStorage.getItem("lockbox-live:v1:messages")).toBeNull();
    expect(localStorage.getItem("cypht-preview:v1:messages")).toBe("sample");
  });
});

describe("sign-in outside a self-hosted server", () => {
  it("leaves the preview on its clearly-labelled demo sign-in", async () => {
    openApp();
    expect(await screen.findByTestId("app")).toBeTruthy();
    expect(screen.queryByText("Sign in to Lockbox")).toBeNull();
  });

  it("leaves the desktop app on its own credential store", async () => {
    (window as unknown as { lockboxMailboxes: unknown }).lockboxMailboxes = { runtime: "desktop", list: vi.fn() };
    openApp();
    expect(await screen.findByTestId("app")).toBeTruthy();
    expect(screen.queryByText("Sign in to Lockbox")).toBeNull();
  });
});
