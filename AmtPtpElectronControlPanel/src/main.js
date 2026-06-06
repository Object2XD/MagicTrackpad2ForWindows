const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function resolveBridgePath() {
  const packagedPath = path.join(process.resourcesPath, 'AmtPtpControlBridge', 'AmtPtpControlBridge.exe');
  if (app.isPackaged) {
    return packagedPath;
  }

  return path.resolve(__dirname, '..', '..', 'AmtPtpControlBridge', 'bin', 'Release', 'AmtPtpControlBridge.exe');
}

const TOUCHPAD_SETTINGS_URI = 'ms-settings:devices-touchpad';
const AUTOSTART_TASK_NAME = 'Magic Trackpad Control Panel';
const APP_ICON_PATH = path.join(__dirname, '..', 'assets', 'icons', 'app.ico');
const TRAY_ICON_DIR = path.join(__dirname, '..', 'assets', 'icons', 'tray');

let mainWindow;
let tray;
let isQuitting = false;
let lastBatteryLabel = null;
let lastBatteryPercentage = null;

function getArgValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  if (value) {
    return value.slice(prefix.length);
  }

  const switchName = name.startsWith('--') ? name.slice(2) : name;
  const switchValue = app.commandLine.getSwitchValue(switchName);
  return switchValue || null;
}

function getNumberArg(name, fallback) {
  const value = Number(getArgValue(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const captureOutputPath = getArgValue('--capture-renderer');
const captureLocale = getArgValue('--capture-locale');
const capturePage = getArgValue('--capture-page');
const isCaptureMode = Boolean(captureOutputPath);
const captureSettings = {
  clickMode: 'macos',
  silentClicking: false,
  feedbackLevel: 1,
  stopMode: 'pressure',
  stopPressure: 0,
  stopSize: 7,
  ignoreNearFingers: true,
  ignoreButtonFinger: true,
  palmRejection: true
};

if (isCaptureMode) {
  const captureUserDataPath = path.join(app.getPath('temp'), 'MagicTrackpadControlPanelCapture');
  fs.mkdirSync(captureUserDataPath, { recursive: true });
  app.setPath('userData', captureUserDataPath);
  app.commandLine.appendSwitch('disk-cache-dir', path.join(captureUserDataPath, 'Cache'));
}

function readLocaleMessages(locale) {
  const normalizedLocale = String(locale || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
  const localePath = path.join(__dirname, 'locales', `${normalizedLocale}.json`);

  try {
    return {
      locale: normalizedLocale,
      messages: JSON.parse(fs.readFileSync(localePath, 'utf8'))
    };
  } catch {
    if (normalizedLocale !== 'en') {
      return readLocaleMessages('en');
    }

    return {
      locale: 'en',
      messages: {}
    };
  }
}

function getMainMessages() {
  return readLocaleMessages(captureLocale || app.getLocale()).messages || {};
}

function getMainMessage(key, fallback) {
  const value = key.split('.').reduce((current, part) => current?.[part], getMainMessages());
  return typeof value === 'string' ? value : fallback;
}

function normalizeBatteryPercentage(value) {
  const percentage = Number(value);
  if (!Number.isFinite(percentage)) {
    return null;
  }

  return Math.min(100, Math.max(0, percentage));
}

function formatBatteryPercentage(percentage) {
  return Number.isInteger(percentage) ? `${percentage}%` : `${percentage.toFixed(1)}%`;
}

function getTrayIconName(percentage) {
  if (percentage === null) {
    return 'tray-unknown.png';
  }

  if (percentage >= 50) {
    return 'tray-green.png';
  }

  if (percentage >= 20) {
    return 'tray-yellow.png';
  }

  return 'tray-red.png';
}

function createTrayIcon(percentage = null) {
  const iconPath = path.join(TRAY_ICON_DIR, getTrayIconName(percentage));
  const image = nativeImage.createFromPath(iconPath);

  if (!image.isEmpty()) {
    return image;
  }

  return nativeImage.createFromPath(APP_ICON_PATH);
}

function normalizeBridgeResult(stdout) {
  const text = stdout.trim();
  if (!text) {
    return { ok: true, data: null };
  }

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && 'ok' in parsed ? parsed : { ok: true, data: parsed };
  } catch {
    return { ok: true, data: text };
  }
}

function runBridge(command, payload) {
  return new Promise((resolve) => {
    const bridgePath = resolveBridgePath();
    if (!fs.existsSync(bridgePath)) {
      resolve({
        ok: false,
        code: 'BRIDGE_MISSING',
        error: 'The control bridge is not installed yet. Settings are shown in preview mode.',
        bridgePath
      });
      return;
    }

    const child = spawn(bridgePath, [command], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({
        ok: false,
        code: 'BRIDGE_ERROR',
        error: error.message,
        bridgePath
      });
    });

    child.on('close', (code) => {
      const parsed = normalizeBridgeResult(stdout);
      if (code !== 0) {
        resolve({
          ...parsed,
          ok: false,
          code: parsed?.error?.code || 'BRIDGE_EXIT',
          error: parsed?.error?.message || stderr.trim() || `Bridge exited with code ${code}.`,
          bridgePath
        });
        return;
      }

      resolve(parsed);
    });

    if (payload !== undefined) {
      child.stdin.write(JSON.stringify(payload));
    }
    child.stdin.end();
  });
}

function runCommand(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        stdout,
        stderr,
        error: error?.message
      });
    });
  });
}

function getAutostartTarget() {
  if (app.isPackaged) {
    return `"${process.execPath}"`;
  }

  return `"${process.execPath}" "${path.resolve(__dirname, '..')}"`;
}

async function getAutostartSettings() {
  if (process.platform !== 'win32') {
    return app.getLoginItemSettings();
  }

  const result = await runCommand('schtasks.exe', ['/Query', '/TN', AUTOSTART_TASK_NAME]);
  return {
    openAtLogin: result.ok,
    taskName: AUTOSTART_TASK_NAME,
    method: 'scheduled-task'
  };
}

async function setAutostartSettings(enabled) {
  if (process.platform !== 'win32') {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: process.execPath
    });
    return app.getLoginItemSettings();
  }

  const result = enabled
    ? await runCommand('schtasks.exe', [
      '/Create',
      '/F',
      '/SC',
      'ONLOGON',
      '/RL',
      'HIGHEST',
      '/TN',
      AUTOSTART_TASK_NAME,
      '/TR',
      getAutostartTarget()
    ])
    : await runCommand('schtasks.exe', ['/Delete', '/F', '/TN', AUTOSTART_TASK_NAME]);

  const current = await getAutostartSettings();
  return {
    ...current,
    ok: result.ok,
    error: result.ok ? null : (result.stderr || result.error || 'Could not update the startup task.')
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    title: 'Magic Trackpad Control Panel',
    icon: APP_ICON_PATH,
    backgroundColor: '#e8e7e3',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForRendererIdle(webContents) {
  await webContents.executeJavaScript(`
    new Promise((resolve) => {
      const finish = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(finish, finish);
      } else {
        finish();
      }
    });
  `);
}

async function captureRenderer() {
  const width = getNumberArg('--capture-width', 980);
  const height = getNumberArg('--capture-height', 680);
  const delay = getNumberArg('--capture-delay', 1200);
  const outputPath = path.resolve(captureOutputPath);

  const captureWindow = new BrowserWindow({
    width,
    height,
    minWidth: width,
    minHeight: height,
    title: 'Magic Trackpad Control Panel Capture',
    icon: APP_ICON_PATH,
    backgroundColor: '#e8e7e3',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  captureWindow.on('closed', () => {
    if (mainWindow === captureWindow) {
      mainWindow = null;
    }
  });

  const loadOptions = capturePage ? { query: { page: capturePage } } : undefined;
  await captureWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'), loadOptions);
  await waitForRendererIdle(captureWindow.webContents);
  await wait(delay);
  await waitForRendererIdle(captureWindow.webContents);

  const image = await captureWindow.webContents.capturePage();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, image.toPNG());

  isQuitting = true;
  captureWindow.destroy();
  app.quit();
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  tray.setImage(createTrayIcon(lastBatteryPercentage));
  const batteryLabel = lastBatteryLabel || getMainMessage('tray.batteryUnavailable', 'Battery unavailable');
  tray.setToolTip(`Magic Trackpad - ${batteryLabel}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: getMainMessage('tray.openSettings', 'Open Settings'),
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    {
      label: getMainMessage('tray.updateBattery', 'Update Battery'),
      click: async () => {
        const result = await getBattery();
        mainWindow?.webContents.send('battery-updated', result);
      }
    },
    {
      label: getMainMessage('tray.windowsTouchpadSettings', 'Windows Touchpad Settings'),
      click: () => openTouchpadSettings()
    },
    { type: 'separator' },
    {
      label: getMainMessage('tray.quit', 'Quit'),
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
}

function createTray() {
  tray = new Tray(createTrayIcon(lastBatteryPercentage));
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
  updateTrayMenu();
  setTimeout(() => {
    if (!isQuitting) {
      getBattery();
    }
  }, 1500);
}

async function getBattery() {
  const result = await runBridge('get-battery');
  if (result.ok) {
    const value = normalizeBatteryPercentage(result.level ?? result.data?.level ?? result.data?.percentage ?? result.data);
    lastBatteryPercentage = value;
    lastBatteryLabel = value === null
      ? getMainMessage('tray.batteryPercentageUnavailable', 'Battery percentage unavailable')
      : getMainMessage('tray.batteryPrefix', 'Battery') + ` ${formatBatteryPercentage(value)}`;
  } else {
    lastBatteryPercentage = null;
    lastBatteryLabel = result.code === 'BRIDGE_MISSING'
      ? getMainMessage('tray.batteryUnavailable', 'Battery unavailable')
      : getMainMessage('tray.batteryUpdateFailed', 'Battery update failed');
  }
  updateTrayMenu();
  return result;
}

async function openTouchpadSettings() {
  const result = await runBridge('open-touchpad-settings');
  if (!result.ok && result.code === 'BRIDGE_MISSING') {
    await shell.openExternal(TOUCHPAD_SETTINGS_URI);
    return {
      ...result,
      fallbackOpened: true,
      error: 'The bridge is not installed yet, so Windows Touchpad Settings were opened directly.'
    };
  }
  return result;
}

ipcMain.handle('settings:read', () => (
  isCaptureMode ? { ok: true, settings: captureSettings } : runBridge('read-settings')
));
ipcMain.handle('settings:apply', (_event, settings) => (
  isCaptureMode ? { ok: true, settings } : runBridge('apply-settings', { settings })
));
ipcMain.handle('battery:get', () => (
  isCaptureMode ? { ok: true, level: 100, validLevel: true } : getBattery()
));
ipcMain.handle('touchpad:openSettings', () => (
  isCaptureMode ? { ok: true } : openTouchpadSettings()
));
ipcMain.handle('autostart:get', () => (
  isCaptureMode ? { openAtLogin: false, method: 'capture-preview' } : getAutostartSettings()
));
ipcMain.handle('autostart:set', (_event, enabled) => (
  isCaptureMode ? { openAtLogin: Boolean(enabled), method: 'capture-preview' } : setAutostartSettings(enabled)
));
ipcMain.handle('locale:get', () => readLocaleMessages(captureLocale || app.getLocale()));

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  if (isCaptureMode) {
    captureRenderer().catch((error) => {
      console.error(error);
      app.exit(1);
    });
    return;
  }

  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // Keep the tray process alive until the user explicitly chooses Quit.
});
