const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  protocol,
  session,
} = require("electron");
const { createStorage } = require("./storage.cjs");

const ROOT_DIR = path.resolve(__dirname, "..");
const APP_SCHEME = "easyticker";
const APP_ORIGIN = `${APP_SCHEME}://app`;
const PRELOAD_PATH = path.join(__dirname, "preload.cjs");
const ICON_PATH = path.join(ROOT_DIR, "icon.png");
const EASTMONEY_URLS = [
  "https://search-codetable.eastmoney.com/*",
  "https://push2.eastmoney.com/*",
  "https://webquotepic.eastmoney.com/*",
];

let tickerWindow;
let optionsWindow;
let tray;
let isQuitting = false;
let storage;
const isSmokeTest = process.argv.includes("--smoke-test");

if (isSmokeTest) {
  app.setPath("userData", path.join(os.tmpdir(), `easyticker-smoke-test-${process.pid}`));
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
]);

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    }[ext] || "application/octet-stream"
  );
}

function resolveAssetPath(requestUrl) {
  const url = new URL(requestUrl);
  const requestPath = decodeURIComponent(url.pathname || "/popup.html");
  const relativePath = requestPath === "/" ? "popup.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(ROOT_DIR, relativePath));

  if (filePath !== ROOT_DIR && !filePath.startsWith(`${ROOT_DIR}${path.sep}`)) {
    throw new Error(`Blocked path outside app root: ${requestUrl}`);
  }

  return filePath;
}

async function handleAppProtocol(request) {
  const filePath = resolveAssetPath(request.url);
  const body = await fs.readFile(filePath);
  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-type": getMimeType(filePath),
    },
  });
}

function setHeader(headers, name, value) {
  const currentName = Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase()
  );
  headers[currentName || name] = [value];
}

function allowEastmoneyCors() {
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: EASTMONEY_URLS },
    (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      setHeader(responseHeaders, "Access-Control-Allow-Origin", "*");
      setHeader(responseHeaders, "Access-Control-Allow-Headers", "*");
      setHeader(responseHeaders, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      callback({ responseHeaders });
    }
  );
}

function getWindowWebPreferences() {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    preload: PRELOAD_PATH,
    sandbox: false,
  };
}

function createTickerWindow() {
  if (tickerWindow && !tickerWindow.isDestroyed()) {
    return tickerWindow;
  }

  tickerWindow = new BrowserWindow({
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    frame: false,
    height: 420,
    maxHeight: 900,
    minHeight: 90,
    minWidth: 220,
    resizable: true,
    show: false,
    title: "EasyTicker",
    transparent: true,
    vibrancy: "popover",
    visualEffectState: "active",
    webPreferences: getWindowWebPreferences(),
    width: 300,
  });

  tickerWindow.setAlwaysOnTop(true, "floating");
  tickerWindow.setFullScreenable(false);
  tickerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  tickerWindow.once("ready-to-show", () => {
    tickerWindow.show();
  });

  tickerWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      tickerWindow.hide();
    }
  });

  tickerWindow.on("closed", () => {
    tickerWindow = null;
  });

  tickerWindow.loadURL(`${APP_ORIGIN}/popup.html`);
  return tickerWindow;
}

function createOptionsWindow() {
  if (optionsWindow && !optionsWindow.isDestroyed()) {
    optionsWindow.show();
    optionsWindow.focus();
    return optionsWindow;
  }

  optionsWindow = new BrowserWindow({
    backgroundColor: "#ffffff",
    height: 780,
    minHeight: 560,
    minWidth: 660,
    show: false,
    title: "EasyTicker Settings",
    webPreferences: getWindowWebPreferences(),
    width: 740,
  });

  optionsWindow.once("ready-to-show", () => {
    optionsWindow.show();
  });

  optionsWindow.on("closed", () => {
    optionsWindow = null;
  });

  optionsWindow.loadURL(`${APP_ORIGIN}/options.html`);
  return optionsWindow;
}

function toggleTickerWindow() {
  if (tickerWindow && !tickerWindow.isDestroyed() && tickerWindow.isVisible()) {
    tickerWindow.hide();
    return;
  }

  showTickerWindow();
}

function showTickerWindow() {
  const win = createTickerWindow();
  win.show();
  win.focus();
}

function createTray() {
  const image = nativeImage.createFromPath(ICON_PATH).resize({ height: 18, width: 18 });
  tray = new Tray(image);
  tray.setToolTip("EasyTicker");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示/隐藏悬浮窗", click: toggleTickerWindow },
      { label: "设置", click: createOptionsWindow },
      { type: "separator" },
      {
        label: "退出",
        click() {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", toggleTickerWindow);
}

function createApplicationMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "EasyTicker",
        submenu: [
          { label: "设置", accelerator: "CmdOrCtrl+,", click: createOptionsWindow },
          { label: "显示/隐藏悬浮窗", accelerator: "CmdOrCtrl+Shift+T", click: toggleTickerWindow },
          { type: "separator" },
          {
            label: "退出",
            accelerator: "CmdOrCtrl+Q",
            click() {
              isQuitting = true;
              app.quit();
            },
          },
        ],
      },
    ])
  );
}

function broadcastStorageChange(area, changes) {
  if (!changes || !Object.keys(changes).length) return;
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send("easyTicker:storage:changed", changes, area);
    }
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSmokeTest() {
  const rendererErrors = [];
  const win = new BrowserWindow({
    height: 420,
    show: false,
    webPreferences: getWindowWebPreferences(),
    width: 300,
  });

  win.webContents.on("console-message", (details) => {
    if (details.level === "warning" || details.level === "error") {
      rendererErrors.push(`${details.sourceId}:${details.lineNumber} ${details.message}`);
    }
  });

  try {
    await win.loadURL(`${APP_ORIGIN}/popup.html`);
    await delay(800);

    const result = await win.webContents.executeJavaScript(`({
      hasApi: !!globalThis.easyTickerChrome?.runtime?.getManifest,
      listText: document.getElementById("list")?.innerText?.trim() || "",
    })`);

    if (!result.hasApi || /Loading/.test(result.listText)) {
      throw new Error(
        `Smoke failed: hasApi=${result.hasApi}, listText=${JSON.stringify(result.listText)}, rendererErrors=${JSON.stringify(rendererErrors)}`
      );
    }

    await win.webContents.executeJavaScript(`document.querySelector(".tip")?.click()`);
    await delay(800);

    if (!optionsWindow || optionsWindow.isDestroyed()) {
      throw new Error("Smoke failed: empty-state settings click did not open options window");
    }

    await optionsWindow.webContents.executeJavaScript(`
      globalThis.easyTickerChrome.storage.sync.set({
        myStocks: [{ code: "600519", name: "贵州茅台", shortName: "贵州茅台", market: 1, enabled: true, type: "沪A" }]
      })
    `);
    await delay(800);

    const updatedText = await win.webContents.executeJavaScript(
      `document.getElementById("list")?.innerText?.trim() || ""`
    );

    if (!updatedText.includes("600519") || !updatedText.includes("贵州茅台")) {
      throw new Error(
        `Smoke failed after storage change: listText=${JSON.stringify(updatedText)}, rendererErrors=${JSON.stringify(rendererErrors)}`
      );
    }

    console.log(`EasyTicker Electron smoke ready: ${updatedText}`);
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
    if (optionsWindow && !optionsWindow.isDestroyed()) {
      optionsWindow.destroy();
      optionsWindow = null;
    }
  }
}

function registerStorageHandlers() {
  storage = createStorage(path.join(app.getPath("userData"), "storage.json"));
  ipcMain.handle("easyTicker:storage:get", (_event, area, keys) => storage.get(area, keys));
  ipcMain.handle("easyTicker:storage:set", (_event, area, items) => {
    broadcastStorageChange(area, storage.set(area, items));
  });
  ipcMain.handle("easyTicker:storage:remove", (_event, area, keys) => {
    broadcastStorageChange(area, storage.remove(area, keys));
  });
  ipcMain.handle("easyTicker:storage:clear", (_event, area) => {
    broadcastStorageChange(area, storage.clear(area));
  });
  ipcMain.handle("easyTicker:window:open-options", () => {
    createOptionsWindow();
  });
}

app.whenReady().then(async () => {
  await protocol.handle(APP_SCHEME, handleAppProtocol);
  allowEastmoneyCors();
  registerStorageHandlers();

  if (isSmokeTest) {
    try {
      await runSmokeTest();
      isQuitting = true;
      app.quit();
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
    return;
  }

  createApplicationMenu();
  createTray();

  if (process.platform === "darwin" && process.env.EASYTICKER_SHOW_DOCK !== "1") {
    app.dock.hide();
  }

  createTickerWindow();
});

app.on("activate", () => {
  showTickerWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
