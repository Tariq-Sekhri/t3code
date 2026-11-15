import * as Effect from "effect/Effect";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

const { logError: logTrayError } = makeComponentLogger("desktop-tray");

// Explorer keeps per-icon visibility here; IsPromoted=1 is "show on the taskbar". The entry
// appears once Explorer first sees the icon, so a fresh install is promoted from its next launch.
const PROMOTE_TRAY_ICON_SCRIPT = String.raw`Get-ChildItem 'HKCU:\Control Panel\NotifyIconSettings' | Where-Object { (Get-ItemProperty $_.PSPath).ExecutablePath -eq $env:T3_TRAY_EXE } | ForEach-Object { Set-ItemProperty $_.PSPath -Name IsPromoted -Value 1 -Type DWord }`;

const promoteTrayIcon = Effect.scoped(
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(
      ChildProcess.make(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", PROMOTE_TRAY_ICON_SCRIPT],
        {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
          env: { T3_TRAY_EXE: process.execPath },
          extendEnv: true,
        },
      ),
    );
    const exitCode = yield* handle.exitCode;
    if (exitCode !== 0) yield* logTrayError("failed to pin tray icon", { exitCode });
  }),
).pipe(
  Effect.catchCause((cause) => logTrayError("failed to pin tray icon", { cause })),
  Effect.withSpan("desktop.tray.promote"),
);

/** Windows tray icon: click opens the window, the menu offers the real Quit. Needs app ready. */
export const register = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const electronApp = yield* ElectronApp.ElectronApp;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const open = () => {
    runFork(
      desktopWindow.activate.pipe(
        Effect.catchCause((cause) => logTrayError("failed to open window from tray", { cause })),
      ),
    );
  };
  const quit = () => {
    runFork(electronApp.quit);
  };
  const icon = yield* Effect.promise(() =>
    Electron.app.getFileIcon(process.execPath, { size: "small" }),
  );
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const tray = new Electron.Tray(icon);
      tray.setToolTip(environment.displayName);
      tray.setContextMenu(
        Electron.Menu.buildFromTemplate([
          { label: `Open ${environment.displayName}`, click: open },
          { type: "separator" },
          { label: `Quit ${environment.displayName}`, click: quit },
        ]),
      );
      tray.on("click", open);
      if (Electron.app.isPackaged) {
        Electron.app.setLoginItemSettings({
          openAtLogin: true,
          args: [DesktopWindow.START_HIDDEN_ARG],
        });
      }
      return tray;
    }),
    (tray) => Effect.sync(() => tray.destroy()),
  );
  if (Electron.app.isPackaged) yield* promoteTrayIcon.pipe(Effect.forkScoped);
}).pipe(Effect.withSpan("desktop.tray.register"));
