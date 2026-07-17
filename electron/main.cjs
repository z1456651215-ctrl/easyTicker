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
  screen,
  session,
} = require("electron");
const { createStorage } = require("./storage.cjs");

const ROOT_DIR = path.resolve(__dirname, "..");
const APP_SCHEME = "easyticker";
const APP_ORIGIN = `${APP_SCHEME}://app`;
const PRELOAD_PATH = path.join(__dirname, "preload.cjs");
const ICON_PATH = path.join(ROOT_DIR, "icon.png");
const TICKER_WINDOW_WIDTH = 260;
const TICKER_WINDOW_HEIGHT = 32;
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
let dragState = null;
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

function pinTickerWindow(win) {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, "screen-saver", 1);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setFullScreenable(false);
  if (typeof win.moveTop === "function") {
    win.moveTop();
  }
}

function createTickerWindow() {
  if (tickerWindow && !tickerWindow.isDestroyed()) {
    pinTickerWindow(tickerWindow);
    return tickerWindow;
  }

  tickerWindow = new BrowserWindow({
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    frame: false,
    height: TICKER_WINDOW_HEIGHT,
    maxHeight: 900,
    minHeight: 30,
    minWidth: 200,
    resizable: true,
    show: false,
    title: "EasyTicker",
    transparent: true,
    vibrancy: "popover",
    visualEffectState: "active",
    webPreferences: getWindowWebPreferences(),
    width: TICKER_WINDOW_WIDTH,
  });

  pinTickerWindow(tickerWindow);

  tickerWindow.once("ready-to-show", () => {
    pinTickerWindow(tickerWindow);
    tickerWindow.show();
  });

  tickerWindow.on("show", () => pinTickerWindow(tickerWindow));
  tickerWindow.on("focus", () => pinTickerWindow(tickerWindow));
  tickerWindow.on("blur", () => pinTickerWindow(tickerWindow));

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
  pinTickerWindow(win);
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

function clampToDisplay(point, size) {
  const { bounds } = screen.getDisplayNearestPoint(point);
  return {
    x: Math.min(Math.max(point.x, bounds.x), bounds.x + bounds.width - size.width),
    y: Math.min(Math.max(point.y, bounds.y), bounds.y + bounds.height - size.height),
  };
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
    height: TICKER_WINDOW_HEIGHT,
    show: false,
    webPreferences: getWindowWebPreferences(),
    width: TICKER_WINDOW_WIDTH,
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

    const optionsState = await optionsWindow.webContents.executeJavaScript(`({
      hasOpacityGroup: !!document.getElementById("window-opacity-group"),
    })`);

    if (!optionsState.hasOpacityGroup) {
      throw new Error("Smoke failed: options window is missing window opacity controls");
    }

    await optionsWindow.webContents.executeJavaScript(`
      globalThis.easyTickerChrome.storage.sync.set({
        language: "zh_CN",
        priceFlashEnabled: false,
        windowOpacity: 55,
        myStocks: [{ code: "600519", name: "贵州茅台", shortName: "贵州茅台", market: 1, enabled: true, type: "沪A" }]
      })
    `);
    await delay(800);

    const updated = await win.webContents.executeJavaScript(`({
      text: document.getElementById("list")?.innerText?.trim() || "",
      hasTrend: !!document.querySelector(".trend-col img"),
      footerDisplay: getComputedStyle(document.getElementById("footer")).display,
      codeDisplay: getComputedStyle(document.querySelector(".stock-code")).display,
      nameFontSize: getComputedStyle(document.querySelector(".stock-name")).fontSize,
      nameFontWeight: getComputedStyle(document.querySelector(".stock-name")).fontWeight,
      nameColor: getComputedStyle(document.querySelector(".stock-name")).color,
      priceDisplay: getComputedStyle(document.querySelector(".p-val")).display,
      pctDisplay: getComputedStyle(document.querySelector(".p-pct")).display,
      pctFontSize: getComputedStyle(document.querySelector(".p-pct")).fontSize,
      pctFontWeight: getComputedStyle(document.querySelector(".p-pct")).fontWeight,
      tickerBgOpacity: document.body.style.getPropertyValue("--ticker-bg-opacity").trim(),
      tickerContentOpacity: document.body.style.getPropertyValue("--ticker-content-opacity").trim(),
      rowOpacity: getComputedStyle(document.querySelector("#list li:not(.tip)")).opacity,
      priceFlashDisabled: document.body.classList.contains("no-price-flash"),
      forcedFlashAnimation: (() => {
        const row = document.querySelector("#list li:not(.tip)");
        row.classList.add("flash-up");
        const animationName = getComputedStyle(row).animationName;
        row.classList.remove("flash-up");
        return animationName;
      })(),
      dragBarDisplay: getComputedStyle(document.getElementById("drag-bar")).display,
      rowCursor: getComputedStyle(document.querySelector("#list li:not(.tip)")).cursor,
      rowTop: Math.round(document.querySelector("#list li").getBoundingClientRect().top),
      rowBottomGap: Math.round(window.innerHeight - document.querySelector("#list li").getBoundingClientRect().bottom),
    })`);

    if (
      !updated.text.includes("贵州茅台") ||
      updated.text.includes("600519") ||
      !updated.hasTrend ||
      updated.footerDisplay !== "none" ||
      updated.codeDisplay !== "none" ||
      updated.nameFontSize !== "12px" ||
      updated.nameFontWeight !== "400" ||
      updated.nameColor !== "rgb(102, 102, 102)" ||
      updated.priceDisplay !== "none" ||
      updated.pctDisplay === "none" ||
      updated.pctFontSize !== "9px" ||
      updated.pctFontWeight !== "400" ||
      updated.tickerBgOpacity !== "0.55" ||
      updated.tickerContentOpacity !== "0.55" ||
      updated.rowOpacity !== "0.55" ||
      !updated.priceFlashDisabled ||
      updated.forcedFlashAnimation !== "none" ||
      updated.dragBarDisplay !== "none" ||
      updated.rowCursor !== "move" ||
      updated.rowTop > 4 ||
      updated.rowBottomGap > 4
    ) {
      throw new Error(
        `Smoke failed after storage change: state=${JSON.stringify(updated)}, rendererErrors=${JSON.stringify(rendererErrors)}`
      );
    }

    const display = screen.getPrimaryDisplay();
    const targetX = display.bounds.x;
    const targetY = display.bounds.y + display.bounds.height - TICKER_WINDOW_HEIGHT;
    win.setPosition(100, 100);
    await win.webContents.executeJavaScript(`
      const row = document.querySelector("#list li:not(.tip)");
      row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, screenX: 110, screenY: 110 }));
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, buttons: 1, screenX: ${110 + targetX - 100}, screenY: ${110 + targetY - 100} }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    `);
    await delay(200);

    const [draggedX, draggedY] = win.getPosition();
    if (draggedX !== targetX || Math.abs(draggedY - targetY) > 1) {
      throw new Error(
        `Smoke failed to drag bottom-left: actual=${JSON.stringify({ x: draggedX, y: draggedY })}, expected=${JSON.stringify({ x: targetX, y: targetY })}`
      );
    }

    console.log(`EasyTicker Electron smoke ready: ${updated.text}`);
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
  ipcMain.on("easyTicker:window:drag-start", (event, point) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    const [width, height] = win.getSize();
    dragState = { win, startPoint: point, startBounds: { x, y, width, height } };
  });
  ipcMain.on("easyTicker:window:drag-move", (event, point) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!dragState || dragState.win !== win || win.isDestroyed()) return;
    const next = clampToDisplay(
      {
        x: dragState.startBounds.x + point.x - dragState.startPoint.x,
        y: dragState.startBounds.y + point.y - dragState.startPoint.y,
      },
      dragState.startBounds
    );
    win.setPosition(next.x, next.y, false);
  });
  ipcMain.on("easyTicker:window:drag-end", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (dragState?.win === win) {
      dragState = null;
    }
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
