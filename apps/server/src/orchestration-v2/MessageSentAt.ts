import * as Config from "effect/Config";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

/** Fork: the desktop app turns this on; off by default so upstream tests keep exact provider text. */
const messageTimestampsConfig = Config.Boolean("T3CODE_MESSAGE_TIMESTAMPS").pipe(
  Config.withDefault(false),
);

/**
 * Fork: stamps provider-bound messages with their local send time so agents can answer
 * "since we last talked". Slash commands stay verbatim; providers parse them from the first character.
 */
export function withMessageSentAt(
  text: string,
  createdAt: DateTime.Utc,
  timeZone?: string,
): string {
  if (text.trimStart().startsWith("/")) return text;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "shortOffset",
    })
      .formatToParts(DateTime.toDateUtc(createdAt))
      .map((part) => [part.type, part.value]),
  );
  const stamp = `${parts.year}-${parts.month}-${parts.day} ${parts.weekday} ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
  return `[Sent ${stamp}]\n${text}`;
}

export const stampMessageSentAt = Effect.fn("MessageSentAt.stamp")(function* (
  text: string,
  createdAt: DateTime.Utc,
) {
  const enabled = yield* messageTimestampsConfig.pipe(Effect.orElseSucceed(() => false));
  return enabled ? withMessageSentAt(text, createdAt) : text;
});
