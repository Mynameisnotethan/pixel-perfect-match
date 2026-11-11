import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// docker-compose.yml is deployed through Hostinger's "Compose from URL", which downloads this file
// alone: no repository folder is cloned. So it must run entirely from published images and must not
// build from a context or bind-mount a relative path.
const compose = readFileSync("docker-compose.yml", "utf8");

const serviceBlock = (name: string) => {
  const match = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  \\S|^volumes:|^\\S)`, "m"));
  if (!match) throw new Error(`service ${name} is missing from docker-compose.yml`);
  return match[1];
};

describe("docker-compose.yml is deployable from a bare URL", () => {
  it("builds nothing from a local folder", () => {
    expect(compose).not.toMatch(/^\s*build:/m);
    expect(compose).not.toMatch(/dockerfile:/);
  });

  it("bind-mounts no relative paths", () => {
    const relativeMount = /^\s*-\s*\.\//m;
    expect(compose).not.toMatch(relativeMount);
    expect(compose).not.toMatch(/:\s*\.\/deploy\/Caddyfile/);
  });

  it("runs every service from a published image", () => {
    for (const service of ["caddy", "web", "mail"]) {
      expect(serviceBlock(service)).toMatch(/image:\s*ghcr\.io\//);
    }
  });

  it("keeps the Caddyfile inside the proxy image instead of mounting it", () => {
    expect(serviceBlock("caddy")).toMatch(/lockbox-proxy/);
    expect(readFileSync("Dockerfile.proxy", "utf8")).toMatch(/COPY deploy\/Caddyfile \/etc\/caddy\/Caddyfile/);
  });

  it("needs nothing but the domain, and keeps the data volume", () => {
    const caddy = serviceBlock("caddy");
    expect(caddy).toMatch(/LOCKBOX_DOMAIN: \$\{LOCKBOX_DOMAIN:\?/);
    expect(serviceBlock("mail")).toMatch(/lockbox-data:\/data/);
  });

  it("asks for no login credentials before deployment", () => {
    // The administrator is created in the browser with a one-time setup code instead.
    expect(compose).not.toMatch(/LOCKBOX_LOGIN_PASSWORD/);
    expect(compose).not.toMatch(/LOCKBOX_LOGIN_USER/);
    expect(compose).not.toMatch(/LOCKBOX_USER_HEADER/);
    expect(compose).not.toMatch(/hash-password/);
  });

  it("lets the mail server own sign-in, so Caddy stores no password", () => {
    const caddyfile = readFileSync("deploy/Caddyfile", "utf8");
    expect(caddyfile).not.toMatch(/basic_auth/);
    expect(caddyfile).toMatch(/\/api\/auth\/\*/);
    expect(caddyfile).toMatch(/reverse_proxy mail:3000/);
    expect(caddyfile).toMatch(/reverse_proxy web:3000/);
  });

  it("lets each owner run images built from their own repository", () => {
    for (const service of ["caddy", "web", "mail"]) {
      expect(serviceBlock(service)).toMatch(/ghcr\.io\/\$\{LOCKBOX_IMAGE_ORG:-/);
    }
  });
});
