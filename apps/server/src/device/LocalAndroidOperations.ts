import { DeviceBootError, type DeviceHostId, DeviceOperationError } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import type { DeviceHostReady, DeviceOperations, HostDevice } from "./DeviceHost.ts";

const GETPROP_LINE = /^\[([^\]]+)\]: \[(.*)\]$/;
const EMULATOR_LOG_LINE = /^(?:INFO|WARNING|ERROR|DEBUG)\s*\|/;
const DEFAULT_BOOT_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

type Run = DeviceHostReady["run"];

/** Serials `adb devices -l` reports as online. Undefined when adb itself failed. */
const onlineSerials = Effect.fn("LocalAndroidOperations.onlineSerials")(function* (run: Run) {
  const listed = yield* run("adb", ["devices", "-l"]);
  if (listed.code !== 0) return undefined;
  return listed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .flatMap(([serial, state]) => (serial && state === "device" ? [serial] : []));
});

const emulatorAvdName = Effect.fn("LocalAndroidOperations.emulatorAvdName")(function* (
  run: Run,
  serial: string,
) {
  const named = yield* run("adb", ["-s", serial, "emu", "avd", "name"]);
  return named.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && line !== "OK" && !line.startsWith("KO"));
});

/** Running Android devices as adb sees them; mirrors expo-device-hub's own adb discovery. */
export const listAdbDevices = Effect.fn("LocalAndroidOperations.listAdbDevices")(function* (
  run: Run,
) {
  const serials = yield* onlineSerials(run);
  if (serials === undefined) return undefined;
  return yield* Effect.forEach(serials, (serial) =>
    Effect.gen(function* () {
      const getprop = yield* run("adb", ["-s", serial, "shell", "getprop"]);
      const props = new Map(
        getprop.stdout.split(/\r?\n/).flatMap((line) => {
          const match = GETPROP_LINE.exec(line.trim());
          return match ? [[match[1]!, match[2]!] as const] : [];
        }),
      );
      const emulator =
        props.get("ro.kernel.qemu") === "1" ||
        props.get("ro.boot.qemu") === "1" ||
        serial.startsWith("emulator-");
      const avdName = emulator
        ? ((yield* emulatorAvdName(run, serial)) ??
          props.get("ro.boot.qemu.avd_name") ??
          props.get("ro.kernel.qemu.avd_name"))
        : undefined;
      const model = props.get("ro.product.model");
      const manufacturer = props.get("ro.product.manufacturer");
      const release = props.get("ro.build.version.release");
      return {
        id: serial,
        name: emulator
          ? avdName || serial
          : model
            ? [manufacturer, model].filter(Boolean).join(" ")
            : serial,
        platform: "android",
        version: release
          ? `Android ${/^\d+$/.test(release) ? `${release}.0` : release}`
          : "Android",
        booted: true,
        physical: !emulator,
      } satisfies HostDevice;
    }),
  );
});

/** AVD names from `emulator -list-avds`, without the emulator's own log lines. */
export const listAndroidAvds = Effect.fn("LocalAndroidOperations.listAndroidAvds")(function* (
  run: Run,
) {
  const result = yield* run("emulator", ["-list-avds"]);
  return {
    code: result.code,
    avds:
      result.code === 0
        ? result.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && !EMULATOR_LOG_LINE.test(line))
        : [],
  };
});

/** Running adb devices, then AVDs that are not running yet. */
const listLocalAndroidDevices = Effect.fn("LocalAndroidOperations.listLocalAndroidDevices")(
  function* (run: Run) {
    const details: Array<string> = [];
    let androidDiscoveryIncomplete = false;
    const devices: Array<HostDevice> = [];
    const running = yield* listAdbDevices(run);
    if (running === undefined) {
      androidDiscoveryIncomplete = true;
      details.push("Could not list Android devices (adb devices -l).");
    } else {
      devices.push(...running);
    }
    const avds = yield* listAndroidAvds(run);
    if (avds.code !== 0) {
      androidDiscoveryIncomplete = true;
      details.push(
        `Could not list Android virtual devices (emulator -list-avds, exit code ${avds.code}). Discovered devices remain available.`,
      );
    }
    for (const name of avds.avds) {
      if (!devices.some((device) => device.platform === "android" && device.name === name)) {
        devices.push({
          id: name,
          name,
          platform: "android",
          version: "Android",
          booted: false,
          physical: false,
        });
      }
    }
    return {
      devices,
      detail: details.join("\n") || undefined,
      androidDiscoveryIncomplete,
    };
  },
);

/**
 * Android emulators run straight from the local SDK as native desktop windows: discovery through
 * `adb devices -l` and `emulator -list-avds`, boot through a detached `emulator -avd <name>`.
 * The serial `boot` returns (such as `emulator-5554`) is what adb addresses the device by.
 */
export const makeLocalAndroidOperations = (options: {
  readonly hostId: DeviceHostId;
  readonly run: Run;
  /** Starts `emulator -avd <name>` detached, with a window. */
  readonly spawnEmulator: (avdName: string) => Effect.Effect<void, DeviceBootError>;
  readonly bootTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}): DeviceOperations => {
  const { hostId, run } = options;
  const bootTimeoutMs = options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  /** The emulator serial running `avdName`, or a new emulator serial that appeared since `before`. */
  const findSerial = Effect.fn("LocalAndroidOperations.findSerial")(function* (
    avdName: string,
    before: ReadonlySet<string> | undefined,
  ) {
    const serials = (yield* onlineSerials(run)) ?? [];
    const emulators = serials.filter((serial) => serial.startsWith("emulator-"));
    for (const serial of emulators) {
      if ((yield* emulatorAvdName(run, serial)) === avdName) return serial;
    }
    return before === undefined ? undefined : emulators.find((serial) => !before.has(serial));
  });

  const bootCompleted = (serial: string) =>
    run("adb", ["-s", serial, "shell", "getprop", "sys.boot_completed"]).pipe(
      Effect.map((result) => result.code === 0 && result.stdout.trim() === "1"),
    );

  const boot: DeviceOperations["boot"] = Effect.fn("LocalAndroidOperations.boot")(
    function* (device) {
      const avdName = device.name || device.id;
      const before = new Set((yield* onlineSerials(run)) ?? []);
      // A running device (already a serial, or an AVD whose emulator is up) is not started twice.
      const running = before.has(device.id) ? device.id : yield* findSerial(avdName, undefined);
      if (running === undefined) yield* options.spawnEmulator(avdName);
      const deadline = (yield* Clock.currentTimeMillis) + bootTimeoutMs;
      let serial = running;
      while (true) {
        serial ??= yield* findSerial(avdName, before);
        if (serial !== undefined && (yield* bootCompleted(serial))) return serial;
        if ((yield* Clock.currentTimeMillis) >= deadline) {
          return yield* new DeviceBootError({
            hostId,
            deviceId: device.id,
            reason: "timeout",
            diagnostics:
              serial === undefined
                ? `No emulator for ${avdName} appeared in adb within ${Math.round(bootTimeoutMs / 1000)} seconds.`
                : `${serial} did not report sys.boot_completed=1 within ${Math.round(bootTimeoutMs / 1000)} seconds.`,
            cause: null,
          });
        }
        yield* Effect.sleep(Duration.millis(pollIntervalMs));
      }
    },
  );

  const shutdown: DeviceOperations["shutdown"] = Effect.fn("LocalAndroidOperations.shutdown")(
    function* (device) {
      const result = yield* run("adb", ["-s", device.id, "emu", "kill"]);
      if (result.code === 0) return;
      // A device that is already gone needs no shutdown.
      if (!((yield* onlineSerials(run)) ?? []).includes(device.id)) return;
      return yield* new DeviceOperationError({
        operation: "shutdown",
        reason: "command_failed",
        exitCode: result.code,
        cause: result.stderr.trim(),
      });
    },
  );

  const screenshot: DeviceOperations["screenshot"] = Effect.fn("LocalAndroidOperations.screenshot")(
    function* (device) {
      const capture = yield* run("adb", ["-s", device.id, "shell", "screencap -p | base64"], {
        timeoutMs: 20_000,
        maxOutputBytes: 64 * 1024 * 1024,
      });
      if (capture.code !== 0) {
        return yield* new DeviceOperationError({
          operation: "screenshot",
          reason: "command_failed",
          exitCode: capture.code,
          cause: capture.stderr.trim(),
        });
      }
      return new Uint8Array(Buffer.from(capture.stdout.replace(/\s+/g, ""), "base64"));
    },
  );

  return {
    list: listLocalAndroidDevices(run),
    boot,
    attach: () => Effect.void,
    shutdown,
    screenshot,
  };
};
