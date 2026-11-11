// Standalone desktop renderer: the same Lockbox screens, bundled into the installer (no server URL needed).
import { createRoot } from "react-dom/client";
import CyphtApp from "../../src/cypht/CyphtApp";
createRoot(document.getElementById("root")!).render(<CyphtApp />);
