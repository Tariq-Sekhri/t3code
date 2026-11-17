import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { stampMessageSentAt, withMessageSentAt } from "./MessageSentAt.ts";

const sentAt = DateTime.makeUnsafe("2026-11-17T19:03:00.000Z");

describe("withMessageSentAt", () => {
  it("prefixes the local send time", () => {
    expect(withMessageSentAt("How have I done?", sentAt, "America/Toronto")).toBe(
      "[Sent 2026-11-17 Tue 14:03 GMT-5]\nHow have I done?",
    );
  });

  it("leaves slash commands verbatim", () => {
    expect(withMessageSentAt("/compact", sentAt, "America/Toronto")).toBe("/compact");
    expect(withMessageSentAt("  /review now", sentAt, "America/Toronto")).toBe("  /review now");
  });

  it.effect("stamps only when T3CODE_MESSAGE_TIMESTAMPS is on", () =>
    Effect.gen(function* () {
      const stamp = (env: Record<string, string>) =>
        stampMessageSentAt("Hi", sentAt).pipe(
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        );
      expect(yield* stamp({})).toBe("Hi");
      expect(yield* stamp({ T3CODE_MESSAGE_TIMESTAMPS: "true" })).toMatch(/^\[Sent .+\]\nHi$/);
    }),
  );
});
