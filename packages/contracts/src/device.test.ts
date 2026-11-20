import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  DeviceBootError,
  DeviceConfigureInput,
  DeviceDisplayMode,
  DeviceId,
  DeviceServiceState,
  DeviceToolOpenInput,
  DeviceToolOpenResult,
  EasDeviceHostConfig,
  SimlockDeviceHostConfig,
  EasDeviceHostConfigs,
  SshDeviceHostConfigs,
} from "./device.ts";
import { secretSettingsFields } from "./settings.ts";

const decodeSshHosts = Schema.decodeUnknownSync(SshDeviceHostConfigs);
const decodeEas = Schema.decodeUnknownSync(EasDeviceHostConfigs);
const encodeState = Schema.encodeSync(DeviceServiceState);
const decodeState = Schema.decodeUnknownSync(DeviceServiceState);
const decodeDisplayMode = Schema.decodeUnknownSync(DeviceDisplayMode);
const decodeConfigureInput = Schema.decodeUnknownSync(DeviceConfigureInput);
const decodeToolOpenInput = Schema.decodeUnknownSync(DeviceToolOpenInput);
const decodeToolOpenResult = Schema.decodeUnknownSync(DeviceToolOpenResult);
// The host summary as clients decoded it before Expo hosts existed.
const decodeOlderState = Schema.decodeUnknownSync(
  Schema.Struct({
    hosts: Schema.Array(
      Schema.Struct({ id: Schema.String, kind: Schema.Literals(["local", "ssh"]) }),
    ),
  }),
);

describe("configured device hosts", () => {
  it("reads SSH hosts saved before hosts had a kind, and bounds Expo Simulators sessions", () => {
    expect(decodeSshHosts([{ id: "mac", label: "Mac mini", target: "julius@mac" }])).toEqual([
      { kind: "ssh", id: "mac", label: "Mac mini", target: "julius@mac" },
    ]);
    expect(decodeEas([{ kind: "eas", id: "eas", label: "Expo Simulators" }])).toEqual([
      {
        kind: "eas",
        id: "eas",
        label: "Expo Simulators",
        accessToken: "",
        maxSessionMinutes: 30,
        idleMinutes: 10,
        maxConcurrentSessions: 2,
      },
    ]);
    expect(() =>
      decodeEas([{ kind: "eas", id: "eas", label: "Expo", maxSessionMinutes: 600 }]),
    ).toThrow();
    // The default idle limit of 10 is not smaller than a session limit of 10.
    expect(() =>
      decodeEas([{ kind: "eas", id: "eas", label: "Expo", maxSessionMinutes: 10 }]),
    ).toThrow();
  });

  it("marks the Expo access token as a secret setting", () => {
    expect(secretSettingsFields(EasDeviceHostConfig)).toEqual(["accessToken"]);
    expect(secretSettingsFields(SimlockDeviceHostConfig)).toEqual(["agentToken"]);
  });
});

describe("device state for clients from before Expo hosts", () => {
  const summary = {
    label: "Host",
    platforms: [],
    hubInstalled: true,
    agentDeviceInstalled: true,
  };
  const state = {
    hosts: [
      { ...summary, id: "local", kind: "local" as const },
      { ...summary, id: "eas", kind: "eas" as const },
      { ...summary, id: "pool", kind: "simlock" as const },
    ],
    hostStatus: "ready" as const,
    hostStatuses: {},
    devices: [],
    sessions: [],
    onboardingCompleted: true,
    agentAccessEnabled: true,
    hubBasePath: "/api/device-hub",
    revision: 1,
  };

  it("sends Expo and Simlock hosts where an older client does not look, and reads them back", () => {
    const wire = encodeState(state);
    expect(decodeOlderState(wire).hosts.map((host) => host.id)).toEqual(["local"]);
    expect(decodeState(wire).hosts).toEqual(state.hosts);
  });
});

describe("device boot errors", () => {
  it("gives a next step instead of blaming the environment server when the host sent no details", () => {
    const message = new DeviceBootError({
      hostId: "mac",
      deviceId: "Pixel_10",
      reason: "launch_failed",
      cause: null,
    }).message;
    expect(message).not.toContain("environment server");
    expect(message).toContain("Try again or open another device");
  });

  it("keeps the host's diagnostics when it sent them", () => {
    const message = new DeviceBootError({
      hostId: "mac",
      deviceId: "Pixel_10",
      reason: "launch_failed",
      diagnostics: "emulator: PANIC: Missing emulator engine program for 'x86_64' CPU.",
      cause: null,
    }).message;
    expect(message).toContain("PANIC: Missing emulator engine program");
    expect(message).not.toContain("Try again");
  });
});

describe("native window local Android contracts", () => {
  it("decodes display mode, configure flag, and agentless device_open results", () => {
    expect(decodeDisplayMode("window")).toBe("window");
    expect(decodeConfigureInput({ localAndroidNativeWindow: true })).toEqual({
      localAndroidNativeWindow: true,
    });
    expect(decodeToolOpenInput({ platform: "android", display: "window" })).toEqual({
      platform: "android",
      display: "window",
    });
    const result = decodeToolOpenResult({
      device: {
        hostId: "local",
        id: DeviceId.make("emulator-5554"),
        platform: "android",
        name: "Pixel_8_API_35",
        version: "Android 15.0",
        booted: true,
        physical: false,
      },
      display: "window",
      adbSerial: "emulator-5554",
      quickStart: "adb -s emulator-5554 install app.apk",
    });
    expect(result.display).toBe("window");
    expect(result.adbSerial).toBe("emulator-5554");
    expect(result.agentDevice).toBeUndefined();
  });
});
