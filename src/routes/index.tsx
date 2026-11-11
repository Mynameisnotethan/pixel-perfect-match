import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const CyphtApp = lazy(() => import("@/cypht/CyphtApp"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cypht — Editable Preview" },
      { name: "description", content: "Editable preview of the Cypht webmail interface with sample data." },
      { property: "og:title", content: "Cypht — Editable Preview" },
      { property: "og:description", content: "Editable preview of the Cypht webmail interface with sample data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "theme-color", content: "#008080" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <ClientOnly fallback={null}>
      <Suspense fallback={null}>
        <CyphtApp />
      </Suspense>
    </ClientOnly>
  );
}
