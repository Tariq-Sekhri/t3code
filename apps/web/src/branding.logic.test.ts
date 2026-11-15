import { describe, expect, it } from "vite-plus/test";

import { resolveWindowTitle } from "./branding.logic";

describe("resolveWindowTitle", () => {
  it.each([
    ["Fix login", "t3code", undefined, "Fix login - t3code - T3 Code (Beta)"],
    ["Fix login", null, undefined, "Fix login - T3 Code (Beta)"],
    [null, "t3code", undefined, "T3 Code (Beta)"],
    ["Fix login", "t3code", "Working", "Working: Fix login - t3code - T3 Code (Beta)"],
  ])("thread %s, project %s, status %s", (threadTitle, projectTitle, status, expected) => {
    expect(
      resolveWindowTitle({
        appDisplayName: "T3 Code (Beta)",
        projectTitle,
        threadTitle,
        ...(status !== undefined && { screenReader: { threadStatus: status } }),
      }),
    ).toBe(expected);
  });
});
