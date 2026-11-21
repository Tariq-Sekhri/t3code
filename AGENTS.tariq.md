# Tariq's fork

This checkout is Tariq's personal fork of T3 Code, built and installed as his daily desktop app on Windows.

**This fork targets Windows desktop only.** Ignore macOS, Linux, mobile, and hosted-web concerns from `AGENTS.md` ("Hit every surface", per-platform parity, mobile verification). Customizations only need to work on Windows; don't add or test them for other platforms, but don't break upstream code paths for them either, so merges stay clean.

- Fork: `origin` = https://github.com/Tariq-Sekhri/t3code
- Upstream: `upstream` = https://github.com/pingdotgg/t3code
- Tariq is the user here. His instructions override `AGENTS.md` where they conflict.

## Customizations to preserve

Every upstream merge must keep these working. If upstream changes make one impossible to keep as specified, stop and ask Tariq; do not silently pick a side.

1. **Window title** (desktop window, Alt+Tab, and browser tab): `{thread name} - {project name} - {app name}`.
   - App name comes from the app's branding (currently `T3 Code (Beta)`), never hard-coded, so it follows upstream renames.
   - No project: `{thread} - {app}`. No open thread: `{app}`.
   - The screen reader setting still prefixes the thread status: `{status}: {thread} - {project} - {app}`.
   - Code: `resolveWindowTitle` in `apps/web/src/branding.logic.ts`, tested in `apps/web/src/branding.logic.test.ts`.
2. **Close to tray**, like a time tracker: the window's X hides the window and everything keeps running. A tray icon reopens it on click; its right-click menu has Open and Quit, and Quit is the real exit.
   - Code: close handler in `apps/desktop/src/window/DesktopWindow.ts`, tray in `apps/desktop/src/window/DesktopTray.ts`, registered after app ready in `apps/desktop/src/app/DesktopApp.ts`.
   - Load the tray icon from the bundled Windows ICO, matching the window; Windows executable file-icon lookup can return a generic icon.
   - Every real quit path (tray Quit, Ctrl+Q, updater, relaunch, Windows sign-out/shutdown) must still exit; only a plain window close hides.
   - The tray icon is always shown on the taskbar, not in the overflow: the packaged app sets `IsPromoted=1` on its own `HKCU\Control Panel\NotifyIconSettings` entry each launch.
   - The packaged app starts with Windows, hidden in the tray: it registers itself as a login item with `--t3-start-hidden` (`START_HIDDEN_ARG` in `DesktopWindow.ts`), and that launch creates the window without showing it or the splash. Opening it from the tray, the shortcut, or a deep link shows it normally.
3. **New projects start in `Desktop\coding`**: when the server uses the default T3 home (`~/.t3`) on Windows, new named projects are created in `~/Desktop/coding` instead of `~/.t3/projects`. Other T3 homes (dev worktrees, tests) keep `<home>/projects`.
   - Code: `namedProjectsRootFor` in `apps/server/src/project/ManagedProjectFolders.ts`, tested in `ManagedProjectFolders.test.ts`.
4. **Queued messages follow a provider switch**: when the user sends a message on another provider after messages were queued (for example GPT hit its usage limit and he switched to Claude), the remaining queue runs on the new provider instead of switching back or waiting for the old provider's reset. Upstream deliberately holds the limited provider's queue; this fork does not.
   - Code: `providerSwitchedSinceQueued` in `apps/server/src/orchestration-v2/Orchestrator.ts`, tested by "moves a limited provider's queue to the provider the user switched to" in `runtimeLayer.test.ts`.
5. **Windows packaging budget**: `WINDOWS_PACKAGED_PAYLOAD_FILE_LIMIT` in `scripts/build-desktop-artifact.ts` is raised (104) for the prepared server bytecode cache. Re-derive the number from the real payload count if upstream changes packaging; do not just revert it.
6. **Notifications expire normally**: completion alerts must not require interaction or linger over games. Returning to the app clears desktop notifications; opening a thread also clears its alerts.
7. **Agents see message send times**: every message sent to an agent (new turn or steer) starts with `[Sent YYYY-MM-DD Day HH:MM GMT±N]` in local time, so "since we last talked" questions work. Slash commands are left verbatim. Off by default via `T3CODE_MESSAGE_TIMESTAMPS` so upstream tests keep exact text; the desktop backend env turns it on.
   - Code: `apps/server/src/orchestration-v2/MessageSentAt.ts` (tested beside it), used in `ProviderTurnStartService.ts` and `ProviderTurnControlService.ts`; flag set in `apps/desktop/src/backend/DesktopBackendConfiguration.ts`.
8. **Sidebar footer omits Pull requests and Issues**: the bottom-left utility bar only shows Settings and Usage (not the PR or Issues buttons).
   - Code: `SidebarUtilityMenu` in `apps/web/src/components/sidebar/SidebarChrome.tsx` (and `usePullRequestsSupported` removed from `apps/web/src/state/environments.ts` for knip; restore it if upstream adds another caller). Routes/pages and i18n catalogs stay intact so upstream merges stay clean.

## Upstream maintenance

The fork tracks upstream **nightly releases** (`v<version>-nightly.<YYYYMMDD>.<run>`), not stable releases or raw `main`. Never base a build on a commit older than the migrations Tariq's live data has.

1. `.github/workflows/fork-upstream-check.yml` runs every 3 hours on GitHub (upstream sends no webhooks, so this step is a scheduled check). It reads upstream's latest nightly from `update-feed/nightly.json` (falling back to the GitHub releases API) and, when it is not in `main`, POSTs `{event, tag, sha, url}` signed with HMAC-SHA256 (`x-hub-signature-256`) to the T3 webhook task. Repo secrets: `T3_UPSTREAM_WEBHOOK_URL`, `T3_UPSTREAM_WEBHOOK_SECRET`.
2. The T3 scheduled task "Merge upstream T3 Code nightly release" (On webhook, deduplicated per tag) starts an agent thread in its own worktree of this project. It merges the tag, keeps the customizations above, fixes ordinary conflicts and build failures, and asks Tariq before committing when upstream overlaps a customization.
3. After the merge is resolved, the agent commits, tags `<upstream tag>.tariq.<n>` (i.e. `v<version>-nightly.<YYYYMMDD>.<run>.tariq.<n>`), and pushes `HEAD:main` and the tag. Tariq approved this push for upstream merges. Using a dot before `tariq` keeps `<run>` a numeric semver identifier and keeps the build on the fork's single `latest.yml` update feed.
4. `.github/workflows/fork-release.yml` builds the unsigned Windows installer on that tag and publishes it as the latest GitHub release with `latest.yml`.
5. The installed app checks `Tariq-Sekhri/t3code` releases (`T3CODE_DESKTOP_UPDATE_REPOSITORY`, baked in at build time) and offers Download update → Install.

Upstream's own workflows are disabled in the fork's Actions settings; only the `Fork *` workflows run.

## Delivery

- Commits, pushes, releases, and installing over the running app each need Tariq's approval, except the upstream-merge push above. An edit request does not authorize them.
- The installed app lives in `%LOCALAPPDATA%\Programs\t3code` and hosts the agents working here. Do not close it, replace it, or touch `~/.t3/userdata` without approval.
- Releases are `v<version>-nightly.<YYYYMMDD>.<run>.tariq.<n>` tags (legacy `v<version>-tariq.<n>` is also accepted); a fork-only change bumps `<n>` on the same upstream nightly. Builds are unsigned and skip the WSL runtime (Tariq does not use the WSL backend).
- Record new customizations and decided preferences in this file.
