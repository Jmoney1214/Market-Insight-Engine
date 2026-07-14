import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { GetCurrentPrincipal200 } from "@workspace/api-client-react";
import {
  establishBrowserSession,
  readCookieValue,
  type AuthState,
} from "./AuthProvider";
import { AuthBoundary } from "./RequireAuth";

const authenticated: AuthState = {
  status: "authenticated",
  principal: {
    principal: {
      principalId: "human-1",
      kind: "human",
      subject: "operator@example.com",
    },
    credentialId: "credential-1",
    effectiveScopes: ["desk:read"],
    authMode: "cookie",
    sessionId: "session-1",
  } as GetCurrentPrincipal200,
};

describe("Desk authentication gate", () => {
  it("does not mount protected children while the principal is anonymous", () => {
    function ProtectedTerminal(): never {
      throw new Error("protected terminal mounted");
    }

    expect(() =>
      renderToStaticMarkup(
        <AuthBoundary
          state={{ status: "anonymous" }}
          anonymous={<div>authentication required</div>}
        >
          <ProtectedTerminal />
        </AuthBoundary>,
      ),
    ).not.toThrow();
  });

  it("renders protected children only after authentication", () => {
    const html = renderToStaticMarkup(
      <AuthBoundary state={authenticated}>
        <div data-testid="terminal">protected desk</div>
      </AuthBoundary>,
    );

    expect(html).toContain("protected desk");
  });

  it("exchanges the permanent key from the call stack and configures only CSRF", async () => {
    const createSession = vi.fn(async () => undefined);
    const whoami = vi.fn(async () => authenticated.principal);
    const configureCsrf = vi.fn();

    const principal = await establishBrowserSession("permanent-human-key", {
      createSession,
      whoami,
      readCsrfToken: () => "csrf-cookie-value",
      configureCsrf,
    });

    const request = createSession.mock.calls[0]?.[0];
    expect(new Headers(request?.headers).get("authorization")).toBe(
      "Bearer permanent-human-key",
    );
    expect(configureCsrf).toHaveBeenCalledOnce();
    expect(configureCsrf.mock.calls[0]?.[0]()).toBe("csrf-cookie-value");
    expect(JSON.stringify(principal)).not.toContain("permanent-human-key");
  });

  it("fails closed when the secure session exchange yields no CSRF cookie", async () => {
    await expect(
      establishBrowserSession("permanent-human-key", {
        createSession: vi.fn(async () => undefined),
        whoami: vi.fn(async () => authenticated.principal),
        readCsrfToken: () => null,
        configureCsrf: vi.fn(),
      }),
    ).rejects.toThrow("CSRF");
  });

  it("reads the exact cookie name without prefix collisions", () => {
    expect(
      readCookieValue("mie_csrf", "other=1; mie_csrf=csrf%20value; mie_csrf_old=bad"),
    ).toBe("csrf value");
  });
});
