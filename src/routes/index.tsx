import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const CyphtApp = lazy(() => import("@/cypht/CyphtApp"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lockbox — Private Webmail" },
      { name: "description", content: "Lockbox webmail with mailbox connections and per-message AI privacy controls." },
      { property: "og:title", content: "Lockbox — Private Webmail" },
      { property: "og:description", content: "Lockbox webmail with mailbox connections and per-message AI privacy controls." },
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
