#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const defaultOutput = path.resolve(
  repoRoot,
  "artifacts",
  "screen-audits",
  `${formatDate(new Date())}-current`,
  "01-current.png"
);
const defaultExe = path.resolve(
  appRoot,
  "dist",
  "win-unpacked",
  "Magic Trackpad Control Panel.exe"
);

const options = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(options.output || defaultOutput);
const exePath = path.resolve(options.exe || defaultExe);
const captureArgs = [
  `--capture-renderer=${outputPath}`,
  `--capture-width=${options.width || "980"}`,
  `--capture-height=${options.height || "680"}`,
  `--capture-delay=${options.delay || "1000"}`,
];

if (options.locale) {
  captureArgs.push(`--capture-locale=${options.locale}`);
}

if (options.page) {
  captureArgs.push(`--capture-page=${options.page}`);
}

if (options.help) {
  printHelp();
  process.exit(0);
}

if (!fs.existsSync(exePath)) {
  fail(
    `Packaged app was not found at ${exePath}\nRun "npm run pack" first, or pass --exe=<absolute path>.`
  );
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

runPackagedCapture(exePath, captureArgs);
waitForPng(outputPath, Number(options.timeout || "45000"));
console.log(`Captured current UI to ${outputPath}`);

function parseArgs(args) {
  const parsed = {};

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) {
      fail(`Unknown argument "${arg}". Use --help for usage.`);
    }

    const key = match[1];
    const value = match[2];

    if (!["output", "exe", "width", "height", "locale", "delay", "timeout", "page"].includes(key)) {
      fail(`Unknown option "--${key}". Use --help for usage.`);
    }

    if (!value) {
      fail(`Option "--${key}" requires a value.`);
    }

    parsed[key] = value;
  }

  return parsed;
}

function runPackagedCapture(exePath, captureArgs) {
  const result = spawnSync(exePath, captureArgs, {
    cwd: appRoot,
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error?.code === "EACCES" && process.platform === "win32") {
    fail(
      `Windows denied launching ${exePath}.\n` +
      `Run "npm run pack:capture" first so the unpacked executable is built without an elevation prompt.`
    );
  }

  if (result.error) {
    fail(`Failed to launch packaged app: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`Packaged app exited with code ${result.status}.`);
  }
}

function waitForPng(filePath, timeoutMs) {
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start <= timeoutMs) {
    try {
      validatePng(filePath);
      return;
    } catch (error) {
      lastError = error;
      sleep(250);
    }
  }

  fail(lastError?.message || `Capture did not create ${filePath}.`);
}

function validatePng(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Capture did not create ${filePath}.`);
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size < 8) {
    throw new Error(`Capture output is not a valid PNG file: ${filePath}`);
  }

  const signature = fs.readFileSync(filePath).subarray(0, 8);
  const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!signature.equals(expected)) {
    throw new Error(`Capture output does not have a PNG signature: ${filePath}`);
  }
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function printHelp() {
  console.log(`Usage:
  node scripts/capture-current-screen.js [options]

Options:
  --output=<absolute png path>  Capture destination. Defaults to ../artifacts/screen-audits/YYYYMMDD-current/01-current.png.
  --exe=<absolute exe path>     Packaged app executable. Defaults to dist/win-unpacked/Magic Trackpad Control Panel.exe.
  --width=<pixels>             Capture viewport width. Defaults to 980.
  --height=<pixels>            Capture viewport height. Defaults to 680.
  --locale=<locale>            Optional locale forwarded to the app, for example ja.
  --page=<page>                Optional page to activate, for example battery.
  --delay=<ms>                 Delay before capture. Defaults to 1000.
  --timeout=<ms>               Time to wait for the output PNG. Defaults to 45000.
  --help                       Show this message.
`);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
