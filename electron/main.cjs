// Electron shell: opens the app in its own window. No server needed. It can update the app itself from
// GitHub Releases (see updater.cjs): newer app bundles are downloaded in the background and applied on restart.
const { app, BrowserWindow, Menu, clipboard, dialog, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const updater = require('./updater.cjs');
const pkg = require('../package.json');

const REPO = 'TraumaTractor/SelfDriveTestCL';
const SHELL_VERSION = pkg.shellVersion || 1;
const API_BASE = process.env.SELFDRIVE_API_BASE || 'https://api.github.com';
const PACKAGED_INDEX = path.join(__dirname, '..', 'dist', 'index.html');
const UPDATES_ENABLED = app.isPackaged || !!process.env.SELFDRIVE_FORCE_UPDATES;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let win = null;
let active = { index: PACKAGED_INDEX, version: pkg.version, isUpdate: false };
let checking = false;
let announced = new Set();

const updatesDir = () => path.join(app.getPath('userData'), 'updates');
const tokenFile = () => path.join(app.getPath('userData'), 'update-token.bin');

// ------------------------------------------------------------------ which copy of the app to run
function chooseApp() {
  const cur = updater.readCurrent(updatesDir());
  if (UPDATES_ENABLED && cur && updater.compareVersions(cur.version, pkg.version) > 0 && (cur.shell || 1) <= SHELL_VERSION) {
    return { index: path.join(cur.dir, 'index.html'), version: cur.version, isUpdate: true };
  }
  return { index: PACKAGED_INDEX, version: pkg.version, isUpdate: false };
}

/** If a downloaded update fails to start, forget it and fall back to the version that shipped. */
function rollBack(reason) {
  if (!active.isUpdate) return;
  console.error(`update ${active.version} failed (${reason}); rolling back`);
  updater.clearCurrent(updatesDir(), active.version);
  active = { index: PACKAGED_INDEX, version: pkg.version, isUpdate: false };
  if (win) win.loadFile(active.index);
}

// -------------------------------------------------------------------------------- update token
function getToken() {
  if (process.env.SELFDRIVE_GITHUB_TOKEN) return process.env.SELFDRIVE_GITHUB_TOKEN;
  try {
    if (fs.existsSync(tokenFile()) && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(fs.readFileSync(tokenFile()));
  } catch { /* unreadable: treat as none */ }
  return undefined;
}

function useTokenFromClipboard() {
  const text = clipboard.readText().trim();
  if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(text)) {
    dialog.showMessageBox(win, {
      type: 'info', message: 'Copy your GitHub token first',
      detail: 'Copy a fine-grained personal access token (it starts with github_pat_) that has read-only access to "Contents" on this repository, then choose this menu item again.',
    });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    dialog.showMessageBox(win, { type: 'error', message: 'Cannot store the token securely on this computer.' });
    return;
  }
  fs.mkdirSync(path.dirname(tokenFile()), { recursive: true });
  fs.writeFileSync(tokenFile(), safeStorage.encryptString(text));
  clipboard.clear();
  dialog.showMessageBox(win, { type: 'info', message: 'Token saved', detail: 'It is stored encrypted on this computer and only used to look for updates. Checking now...' });
  checkForUpdates(true);
}

// ------------------------------------------------------------------------------- update checks
function restartIntoUpdate() {
  const opts = process.env.PORTABLE_EXECUTABLE_FILE ? { execPath: process.env.PORTABLE_EXECUTABLE_FILE } : {};
  app.relaunch(opts);
  app.exit(0);
}

async function checkForUpdates(manual) {
  if (checking) return;
  if (!UPDATES_ENABLED) {
    if (manual) dialog.showMessageBox(win, { type: 'info', message: 'Updates are only checked in the installed app.' });
    return;
  }
  checking = true;
  console.error(`[updater] checking (installed ${active.version})`);
  try {
    const r = await updater.checkForUpdate({
      apiBase: API_BASE, repo: REPO, token: getToken(), currentVersion: active.version,
      shellVersion: SHELL_VERSION, updatesDir: updatesDir(), skip: updater.readBad(updatesDir()),
    });
    console.error(`[updater] result: ${r.status} ${r.version}`);
    if (r.status === 'up-to-date') {
      if (manual) dialog.showMessageBox(win, { type: 'info', message: `You're up to date`, detail: `Version ${active.version}` });
    } else if (r.status === 'ready') {
      if (process.env.SELFDRIVE_UPDATE_AUTO === 'quit') { app.quit(); return; }
      if (announced.has(r.version) && !manual) return;
      announced.add(r.version);
      const { response } = await dialog.showMessageBox(win, {
        type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
        message: `Version ${r.version} is ready`, detail: `${r.notes ? r.notes + '\n\n' : ''}Restart to start using it. Your rules and settings are kept.`,
      });
      if (response === 0) restartIntoUpdate();
    } else if (r.status === 'needs-installer') {
      if (announced.has(r.version) && !manual) return;
      announced.add(r.version);
      const { response } = await dialog.showMessageBox(win, {
        type: 'info', buttons: ['Open download page', 'Later'], defaultId: 0, cancelId: 1,
        message: `Version ${r.version} needs a new installer`,
        detail: 'This update changes the app shell itself, so it cannot be applied automatically. Download and install it once; after that, updates are automatic again.',
      });
      if (response === 0) shell.openExternal(r.url);
    }
  } catch (e) {
    console.error('update check failed:', e.message);
    if (manual) {
      const hint = e.code === 'private-or-missing'
        ? 'GitHub would not show the releases. If the repository is private, choose "Use Update Token from Clipboard" in the menu (you need a read-only token), or make the repository public.'
        : e.code === 'denied' ? 'GitHub rejected the saved token. Create a new read-only token and choose "Use Update Token from Clipboard".'
        : e.code === 'offline' ? 'Check your internet connection and try again.' : '';
      dialog.showMessageBox(win, { type: 'warning', message: "Couldn't check for updates", detail: `${e.message}\n\n${hint}`.trim() });
    }
  } finally {
    checking = false;
  }
}

// ----------------------------------------------------------------------------------------- window
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 900, minHeight: 600,
    backgroundColor: '#0e1218', title: 'Self-Drive Test Bench', show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(active.index);

  // A downloaded update must prove it started; otherwise fall back to the shipped version.
  win.webContents.on('did-fail-load', (_e, _code, desc, _url, isMainFrame) => { if (isMainFrame) rollBack(desc); });
  win.webContents.on('render-process-gone', (_e, d) => rollBack(d.reason));
  win.webContents.on('did-finish-load', () => {
    if (!active.isUpdate) return;
    setTimeout(async () => {
      try {
        const t = await win.webContents.executeJavaScript('typeof window.__app');
        if (t !== 'object') throw new Error('the updated app did not start');
      } catch (e) { rollBack(e.message); }
    }, 4000);
  });

  // The app is self-contained: never navigate away or open extra windows inside it.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Developer smoke test: SELFDRIVE_SMOKE=/path/out.png electron .  -> saves a screenshot and quits.
  if (process.env.SELFDRIVE_SMOKE) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.SELFDRIVE_SMOKE, img.toPNG());
        app.quit();
      }, Number(process.env.SELFDRIVE_SMOKE_DELAY_MS ?? 3500));
    });
  }
}

app.whenReady().then(() => {
  active = chooseApp();
  const updateItems = [
    { label: 'Check for Updates…', click: () => checkForUpdates(true) },
    { label: 'Use Update Token from Clipboard', click: useTokenFromClipboard },
  ];
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: `Version ${active.version}${active.isUpdate ? ' (updated)' : ''}`, enabled: false }, ...updateItems] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();

  const delay = Number(process.env.SELFDRIVE_UPDATE_DELAY_MS ?? 8000);
  setTimeout(() => checkForUpdates(false), delay);
  setInterval(() => checkForUpdates(false), CHECK_EVERY_MS);

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
