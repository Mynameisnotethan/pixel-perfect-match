import { Component, type ReactNode } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "./styles/upstream-core.css";
import "./styles/upstream-theme.css";
import "./styles/preview.css";
// @ts-expect-error - original JavaScript preview source has no TypeScript declarations
import App from "./App.jsx";

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: unknown) { console.error("Lockbox preview crashed:", String((error as Error)?.stack ?? error)); }
  override render() {
    if (this.state.failed) return <div style={{ padding: 40, fontFamily: "system-ui" }}><h1>Preview could not open</h1><p>Saved preview data may be incompatible with this version.</p><button onClick={() => { Object.keys(localStorage).filter(k => k.startsWith("cypht-preview:")).forEach(k => localStorage.removeItem(k)); location.reload(); }}>Reset preview data</button></div>;
    return this.props.children;
  }
}
export default function CyphtApp() { return <ErrorBoundary><App /></ErrorBoundary>; }
