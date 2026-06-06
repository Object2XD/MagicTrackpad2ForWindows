# Magic Trackpad Electron Control Panel

Modern Electron shell for Magic Trackpad settings on Windows. This app mirrors the existing WinForms control panel concepts and calls `AmtPtpControlBridge` for registry and device operations.

## Run

```powershell
npm install --strict-ssl=false
npm start
```

## Package

```powershell
npm run build
```

The `package.json` includes an `electron-builder` Windows NSIS configuration with `requestedExecutionLevel` set to `requireAdministrator` for the initial bridge/driver-management version.
Because the app runs elevated, Windows autostart is registered as a highest-privilege scheduled task named `Magic Trackpad Control Panel` instead of a normal Run/login item.

## Current Screen Capture

Build an unpacked app before capturing. This capture build keeps the production installer settings unchanged, but runs the unpacked executable without an elevation prompt so automation can launch it:

```powershell
npm run pack:capture
```

Capture the current renderer UI with the default viewport and output path:

```powershell
npm run capture:current
```

The default output is `../artifacts/screen-audits/YYYYMMDD-current/01-current.png` from this app folder. To choose a destination or viewport:

```powershell
npm run capture:current -- --output=C:\tmp\magic-trackpad-current.png --width=980 --height=680 --locale=ja --delay=1000
```

The helper runs `dist/win-unpacked/Magic Trackpad Control Panel.exe` with `--capture-renderer=<png path>` and validates that a PNG exists afterward. If you need a non-default executable, pass `--exe=<absolute exe path>`.

## Bridge Contract

During development, the main process calls:

```text
../AmtPtpControlBridge/bin/Release/AmtPtpControlBridge.exe
```

Packaged builds include the bridge in `resources/AmtPtpControlBridge` via `extraResources`.

Commands are sent as the first argument:

- `read-settings`
- `apply-settings`
- `get-battery`
- `open-touchpad-settings`

`applySettings` receives the renderer settings JSON on stdin. Bridge stdout may be plain text or JSON. JSON responses can either be direct data or an envelope like:

```json
{
  "ok": true,
  "settings": {
    "clickMode": "macos",
    "feedbackLevel": 1,
    "silentClicking": false,
    "stopMode": "pressure",
    "stopPressure": 0,
    "stopSize": 7,
    "ignoreButtonFinger": true,
    "ignoreNearFingers": true,
    "palmRejection": true
  }
}
```

If the bridge is missing, the UI stays usable in preview mode and shows friendly status messages instead of throwing.

## Icons And Tray Battery

The Windows executable and installer use `assets/icons/app.ico`, generated from `assets/icons/app-icon-source.png` with `assets/icons/build-icon.js`.
The generated tray icon updates after battery refreshes: green for 50% and above, yellow for 20-49%, red below 20%, and gray when the battery percentage is unavailable. The tray tooltip also shows the latest battery percentage when the bridge reports one.
