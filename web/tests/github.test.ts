import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchWorkflow, parsePrUrl } from "@/lib/github";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parsePrUrl", () => {
  it("parses PR urls, including trailing paths", () => {
    expect(parsePrUrl("https://github.com/acme/api/pull/42/files")).toEqual({
      owner: "acme",
      repo: "api",
      number: 42,
    });
  });
  it("rejects anything else", () => {
    expect(parsePrUrl("https://github.com/acme/api/issues/1")).toBeNull();
    expect(parsePrUrl("https://evil.com/acme/api/pull/1")).toBeNull();
  });
});

describe("dispatchWorkflow", () => {
  it("posts the run id to the runner workflow", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    vi.stubEnv("RUNNER_REPO", "me/mogo");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await dispatchWorkflow("run-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/repos/me/mogo/actions/workflows/run-agent.yml/dispatches",
    );
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({
      ref: "main",
      inputs: { run_id: "run-1" },
    });
  });

  it("throws on non-204 and on missing config", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    vi.stubEnv("RUNNER_REPO", "me/x");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 })),
    );
    await expect(dispatchWorkflow("r")).rejects.toThrow("404");
    vi.stubEnv("RUNNER_REPO", "");
    await expect(dispatchWorkflow("r")).rejects.toThrow("must be set");
  });
});
