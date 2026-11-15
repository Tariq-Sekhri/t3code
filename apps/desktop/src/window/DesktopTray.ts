import * as Effect from "effect/Effect";

import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

const { logError: logTrayError } = makeComponentLogger("desktop-tray");

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
      return tray;
    }),
    (tray) => Effect.sync(() => tray.destroy()),
  );
}).pipe(Effect.withSpan("desktop.tray.register"));
