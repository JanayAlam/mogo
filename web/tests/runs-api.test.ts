import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/runs", () => ({
  insertRun: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  markRunFailed: vi.fn(),
}));

import { GET as getOne } from "@/app/api/runs/[id]/route";
import { POST as create, GET as list } from "@/app/api/runs/route";
import * as runs from "@/lib/runs";

const post = (body: unknown) =>
  create(
    new Request("http://x/api/runs", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const PR = "https://github.com/acme/api/pull/7";

beforeEach(() => {
  vi.stubEnv("GITHUB_TOKEN", "tok");
  vi.stubEnv("RUNNER_REPO", "me/mogo");
  vi.stubEnv("ALLOWED_REPOS", "acme/api");
  vi.mocked(runs.insertRun).mockImplementation(
    async (r) => ({ id: "run-1", status: "queued", ...r }) as never,
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("POST /api/runs", () => {
  it("stores the run, dispatches the workflow, returns 201", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({
      pr_url: PR,
      feature: "works",
      llm_mode: "local",
      dry_run: true,
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(runs.insertRun)).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "acme/api",
        pr_number: 7,
        llm_mode: "local",
        dry_run: true,
        feature: "works",
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).inputs.run_id).toBe(
      "run-1",
    );
  });

  it.each([
    ["bad json", "not json"],
    ["missing url", {}],
    ["not a PR", { pr_url: "https://github.com/acme/api/issues/1" }],
    ["bad mode", { pr_url: PR, llm_mode: "gpt" }],
    ["feature too long", { pr_url: PR, feature: "x".repeat(5001) }],
    [
      "repo not in ALLOWED_REPOS",
      { pr_url: "https://github.com/other/repo/pull/1" },
    ],
  ])("422 on %s and stores nothing", async (_n, body) => {
    expect((await post(body)).status).toBe(422);
    expect(runs.insertRun).not.toHaveBeenCalled();
  });

  it("marks the run failed and returns 502 when dispatch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500 })),
    );
    const res = await post({ pr_url: PR });
    expect(res.status).toBe(502);
    expect(runs.markRunFailed).toHaveBeenCalledWith(
      "run-1",
      expect.stringContaining("500"),
    );
  });
});

describe("GET", () => {
  it("lists runs", async () => {
    vi.mocked(runs.listRuns).mockResolvedValue([{ id: "a" }] as never);
    expect(await (await list()).json()).toEqual([{ id: "a" }]);
  });
  it("404s for an unknown run, returns known ones", async () => {
    vi.mocked(runs.getRun).mockResolvedValueOnce(null);
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await getOne(new Request("http://x"), ctx("nope"))).status).toBe(
      404,
    );
    vi.mocked(runs.getRun).mockResolvedValueOnce({
      id: "r",
      events: [],
    } as never);
    expect(
      await (await getOne(new Request("http://x"), ctx("r"))).json(),
    ).toEqual({ id: "r", events: [] });
  });
});
