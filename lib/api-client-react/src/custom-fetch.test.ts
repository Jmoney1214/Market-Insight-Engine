import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  customFetch,
  setAuthTokenGetter,
  setBaseUrl,
  setCsrfTokenGetter,
  setUnauthorizedHandler,
} from "./custom-fetch";

function successfulFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("authenticated custom fetch", () => {
  beforeEach(() => {
    setBaseUrl(null);
    setAuthTokenGetter(null);
    setCsrfTokenGetter(null);
    setUnauthorizedHandler(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds cookies and CSRF to unsafe browser-relative requests", async () => {
    const fetchMock = successfulFetch();
    vi.stubGlobal("fetch", fetchMock);
    setCsrfTokenGetter(() => "csrf-value");

    await customFetch("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({ ticker: "AAPL" }),
      responseType: "json",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    const headers = new Headers(init?.headers);
    expect(headers.get("x-csrf-token")).toBe("csrf-value");
  });

  it("includes cookies but no CSRF on safe browser-relative GETs", async () => {
    const fetchMock = successfulFetch();
    vi.stubGlobal("fetch", fetchMock);
    setCsrfTokenGetter(() => "csrf-value");

    await customFetch("/api/reports", { responseType: "json" });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).has("x-csrf-token")).toBe(false);
  });

  it("does not attach cookie or CSRF configuration to absolute cross-origin calls", async () => {
    const fetchMock = successfulFetch();
    vi.stubGlobal("fetch", fetchMock);
    setCsrfTokenGetter(() => "csrf-value");

    await customFetch("https://provider.example/data", {
      method: "POST",
      body: "{}",
      responseType: "json",
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.credentials).toBeUndefined();
    expect(new Headers(init?.headers).has("x-csrf-token")).toBe(false);
  });

  it("does not add CSRF when the caller supplies explicit bearer authorization", async () => {
    const fetchMock = successfulFetch();
    vi.stubGlobal("fetch", fetchMock);
    setCsrfTokenGetter(() => "csrf-value");

    await customFetch("/api/governance/principals", {
      method: "POST",
      headers: { authorization: "Bearer permanent-key" },
      body: "{}",
      responseType: "json",
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).has("x-csrf-token")).toBe(false);
  });

  it("adds a caller-provided stable idempotency key without leaking the custom option", async () => {
    const fetchMock = successfulFetch();
    vi.stubGlobal("fetch", fetchMock);

    await customFetch("/api/analyze", {
      method: "POST",
      body: JSON.stringify({ ticker: "AAPL" }),
      idempotencyKey: "logical-action-1",
      responseType: "json",
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      "logical-action-1",
    );
    expect(init).not.toHaveProperty("idempotencyKey");
  });

  it("notifies the browser auth boundary before surfacing a relative 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "expired" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);

    await expect(
      customFetch("/api/reports", { responseType: "json" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledOnce();
  });
});
