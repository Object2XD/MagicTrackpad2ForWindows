let messages = {};

const defaultSettings = {
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

const defaultMessages = {
  app: {
    title: 'Magic Trackpad Control Panel'
  },
  bridge: {
    connected: 'Bridge connected',
    preview: 'Bridge preview mode',
    missing: 'The control bridge is not installed yet. Settings are shown in preview mode.'
  },
  feedback: {
    light: 'Light',
    medium: 'Medium',
    firm: 'Firm'
  },
  battery: {
    checking: 'Checking battery...',
    unavailable: 'Battery unavailable',
    missingPercentage: 'Battery response did not include a percentage',
    bluetooth: 'Bluetooth battery',
    outsideRange: 'Battery response was outside 0-100%'
  },
  startup: {
    updated: 'Startup updated',
    enabled: 'The app will open at login.',
    disabled: 'The app will not open at login.'
  },
  status: {
    loading: 'Loading',
    loadingDetail: 'Reading current settings from the bridge.',
    ready: 'Ready',
    readyDetail: 'Changes apply through the bridge when available.',
    loadedDetail: 'Current bridge settings loaded.',
    previewMode: 'Preview mode',
    previewDetail: 'Using safe defaults until the bridge is available.',
    applying: 'Applying',
    applyingDetail: 'Sending settings to the bridge.',
    applied: 'Applied',
    appliedDetail: 'Settings were accepted by the bridge.',
    couldNotApply: 'Could not apply',
    applyRejected: 'The bridge did not accept the settings.',
    openedSettings: 'Opened Settings',
    couldNotOpenSettings: 'Could not open Settings',
    windowsSettingsCompleted: 'Windows Touchpad Settings request completed.',
    bridgeMissingSettingsOpened: 'The bridge is not installed yet, so Windows Touchpad Settings were opened directly.'
  }
};

const elements = {
  bridgeStatus: document.querySelector('#bridgeStatus'),
  statusDot: document.querySelector('.status-dot'),
  pageTitle: document.querySelector('#pageTitle'),
  pageSubtitle: document.querySelector('#pageSubtitle'),
  pageLinks: Array.from(document.querySelectorAll('[data-page]')),
  pagePanels: Array.from(document.querySelectorAll('[data-page-panel]')),
  feedback: document.querySelector('#feedback'),
  feedbackLabel: document.querySelector('#feedbackLabel'),
  feedbackChoices: Array.from(document.querySelectorAll('input[name="feedbackChoice"]')),
  silentClicking: document.querySelector('#silentClicking'),
  stopPressure: document.querySelector('#stopPressure'),
  stopSize: document.querySelector('#stopSize'),
  ignoreNearFingers: document.querySelector('#ignoreNearFingers'),
  ignoreButtonFinger: document.querySelector('#ignoreButtonFinger'),
  palmRejection: document.querySelector('#palmRejection'),
  batteryValue: document.querySelector('#batteryValue'),
  batteryCaption: document.querySelector('#batteryCaption'),
  batteryLevel: document.querySelector('#batteryLevel'),
  launchAtLogin: document.querySelector('#launchAtLogin'),
  saveState: document.querySelector('#saveState'),
  saveDetail: document.querySelector('#saveDetail'),
  applySettings: document.querySelector('#applySettings'),
  updateBattery: document.querySelector('#updateBattery'),
  openWindowsSettings: document.querySelector('#openWindowsSettings')
};

function getMessage(key, fallback = key) {
  const value = key.split('.').reduce((current, part) => current?.[part], messages);
  const defaultValue = key.split('.').reduce((current, part) => current?.[part], defaultMessages);
  return typeof value === 'string' ? value : (typeof defaultValue === 'string' ? defaultValue : fallback);
}

function getResultError(result, fallbackKey) {
  if (result?.code === 'BRIDGE_MISSING') {
    return getMessage('bridge.missing');
  }

  return result?.error || getMessage(fallbackKey);
}

function applyTranslations() {
  document.title = getMessage('app.title', document.title);

  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = getMessage(node.dataset.i18n, node.textContent);
  });

  document.querySelectorAll('[data-i18n-attr]').forEach((node) => {
    node.dataset.i18nAttr.split(';').forEach((binding) => {
      const [attribute, key] = binding.split(':');
      if (attribute && key) {
        node.setAttribute(attribute.trim(), getMessage(key.trim(), node.getAttribute(attribute.trim()) || ''));
      }
    });
  });
}

async function loadLocale() {
  try {
    const locale = await window.amtPtp.getLocale();
    messages = locale?.messages || {};
    document.documentElement.lang = locale?.locale || 'en';
  } catch {
    messages = {};
    document.documentElement.lang = 'en';
  }

  applyTranslations();
}

function setStatus(title, detail, isWorking = false) {
  elements.saveState.textContent = title;
  elements.saveDetail.textContent = detail;
  elements.applySettings.disabled = isWorking;
}

function setBridgeStatus(result) {
  const online = Boolean(result?.ok);
  elements.statusDot.classList.toggle('online', online);
  elements.bridgeStatus.textContent = online ? getMessage('bridge.connected') : getMessage('bridge.preview');
}

function getFiniteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeFeedbackLevel(value) {
  return Math.max(0, Math.min(2, Math.round(getFiniteNumber(value, defaultSettings.feedbackLevel))));
}

function setActivePage(page) {
  const targetPanel = elements.pagePanels.find((panel) => panel.dataset.pagePanel === page) || elements.pagePanels[0];
  if (!targetPanel) {
    return;
  }

  const targetPage = targetPanel.dataset.pagePanel;

  elements.pageLinks.forEach((link) => {
    const isActive = link.dataset.page === targetPage;
    link.classList.toggle('active', isActive);
    link.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  elements.pagePanels.forEach((panel) => {
    panel.hidden = panel.dataset.pagePanel !== targetPage;
  });

  if (elements.pageTitle) {
    elements.pageTitle.textContent = targetPanel.dataset.title || targetPanel.querySelector('h2')?.textContent || '';
  }
  if (elements.pageSubtitle) {
    elements.pageSubtitle.textContent = targetPanel.dataset.subtitle || '';
  }
}

function readForm() {
  return {
    clickMode: document.querySelector('input[name="clickMode"]:checked')?.value || defaultSettings.clickMode,
    silentClicking: elements.silentClicking.checked,
    feedbackLevel: normalizeFeedbackLevel(elements.feedback.value),
    stopMode: document.querySelector('input[name="stopMode"]:checked')?.value || defaultSettings.stopMode,
    stopPressure: Number(elements.stopPressure.value),
    stopSize: Number(elements.stopSize.value),
    ignoreNearFingers: elements.ignoreNearFingers.checked,
    ignoreButtonFinger: elements.ignoreButtonFinger.checked,
    palmRejection: elements.palmRejection.checked
  };
}

function writeForm(settings) {
  const merged = { ...defaultSettings, ...settings };
  const clickMode = document.querySelector(`input[name="clickMode"][value="${merged.clickMode}"]`);
  const stopMode = document.querySelector(`input[name="stopMode"][value="${merged.stopMode}"]`);

  if (clickMode) {
    clickMode.checked = true;
  }
  if (stopMode) {
    stopMode.checked = true;
  }

  elements.silentClicking.checked = Boolean(merged.silentClicking);
  elements.feedback.value = String(normalizeFeedbackLevel(merged.feedbackLevel));
  syncFeedbackChoices();
  elements.stopPressure.value = String(getFiniteNumber(merged.stopPressure, defaultSettings.stopPressure));
  elements.stopSize.value = String(getFiniteNumber(merged.stopSize, defaultSettings.stopSize));
  elements.ignoreNearFingers.checked = Boolean(merged.ignoreNearFingers);
  elements.ignoreButtonFinger.checked = Boolean(merged.ignoreButtonFinger);
  elements.palmRejection.checked = Boolean(merged.palmRejection);
  updateFeedbackLabel();
}

function updateFeedbackLabel() {
  const feedbackLabels = [
    getMessage('feedback.light'),
    getMessage('feedback.medium'),
    getMessage('feedback.firm')
  ];
  elements.feedbackLabel.textContent = feedbackLabels[Number(elements.feedback.value)] || getMessage('feedback.medium');
}

function syncFeedbackChoices() {
  const value = String(normalizeFeedbackLevel(elements.feedback.value));
  elements.feedback.value = value;
  elements.feedbackChoices.forEach((choice) => {
    choice.checked = choice.value === value;
  });
}

function setFeedbackLevel(value) {
  elements.feedback.value = String(normalizeFeedbackLevel(value));
  syncFeedbackChoices();
  updateFeedbackLabel();
}

function renderBattery(result) {
  setBridgeStatus(result);

  if (!result?.ok) {
    elements.batteryValue.textContent = '?';
    elements.batteryCaption.textContent = getResultError(result, 'battery.unavailable');
    elements.batteryLevel.style.width = '0%';
    return;
  }

  const percentage = Number(result.level ?? result.data?.level ?? result.data?.percentage ?? result.data);

  if (!Number.isFinite(percentage)) {
    elements.batteryValue.textContent = '?';
    elements.batteryCaption.textContent = getMessage('battery.missingPercentage');
    elements.batteryLevel.style.width = '0%';
    return;
  }

  const clamped = Math.max(0, Math.min(100, percentage));
  const validLevel = result.validLevel ?? (percentage >= 0 && percentage <= 100);
  elements.batteryValue.textContent = `${clamped}%`;
  elements.batteryCaption.textContent = validLevel ? getMessage('battery.bluetooth') : getMessage('battery.outsideRange');
  elements.batteryLevel.style.width = `${clamped}%`;
}

async function loadSettings() {
  setStatus(getMessage('status.loading'), getMessage('status.loadingDetail'), true);
  const result = await window.amtPtp.readSettings();
  setBridgeStatus(result);

  if (result.ok && result.settings) {
    writeForm(result.settings);
    setStatus(getMessage('status.ready'), getMessage('status.loadedDetail'));
    return;
  }

  writeForm(defaultSettings);
  setStatus(getMessage('status.previewMode'), getResultError(result, 'status.previewDetail'));
}

async function loadAutostart() {
  const result = await window.amtPtp.getAutostart();
  elements.launchAtLogin.checked = Boolean(result?.openAtLogin);
}

async function refreshBattery() {
  elements.batteryCaption.textContent = getMessage('battery.checking');
  const result = await window.amtPtp.getBattery();
  renderBattery(result);
}

async function applySettings() {
  const settings = readForm();
  setStatus(getMessage('status.applying'), getMessage('status.applyingDetail'), true);
  const result = await window.amtPtp.applySettings(settings);
  setBridgeStatus(result);

  if (result.ok) {
    setStatus(getMessage('status.applied'), getMessage('status.appliedDetail'));
    return;
  }

  setStatus(getMessage('status.couldNotApply'), getResultError(result, 'status.applyRejected'));
}

function bindEvents() {
  elements.pageLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setActivePage(link.dataset.page);
      history.replaceState(null, '', link.getAttribute('href'));
    });
  });
  elements.feedbackChoices.forEach((choice) => {
    choice.addEventListener('change', () => {
      if (choice.checked) {
        setFeedbackLevel(choice.value);
      }
    });
  });
  elements.feedback.addEventListener('input', () => setFeedbackLevel(elements.feedback.value));
  elements.applySettings.addEventListener('click', applySettings);
  elements.updateBattery.addEventListener('click', refreshBattery);
  elements.openWindowsSettings.addEventListener('click', async () => {
    const result = await window.amtPtp.openTouchpadSettings();
    setBridgeStatus(result);
    setStatus(
      result.ok || result.fallbackOpened ? getMessage('status.openedSettings') : getMessage('status.couldNotOpenSettings'),
      result.fallbackOpened ? getMessage('status.bridgeMissingSettingsOpened') : (result.error || getMessage('status.windowsSettingsCompleted'))
    );
  });
  elements.launchAtLogin.addEventListener('change', async () => {
    const result = await window.amtPtp.setAutostart(elements.launchAtLogin.checked);
    elements.launchAtLogin.checked = Boolean(result?.openAtLogin);
    setStatus(
      getMessage('startup.updated'),
      elements.launchAtLogin.checked ? getMessage('startup.enabled') : getMessage('startup.disabled')
    );
  });
  window.amtPtp.onBatteryUpdated(renderBattery);
}

async function initialize() {
  await loadLocale();
  setFeedbackLevel(elements.feedback.value);
  bindEvents();
  const requestedPage = new URLSearchParams(location.search).get('page') || location.hash.slice(1) || 'clicking';
  setActivePage(requestedPage);
  loadSettings();
  loadAutostart();
  refreshBattery();
}

initialize();
