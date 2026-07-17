const { contextBridge, ipcRenderer } = require("electron");
const manifest = require("../manifest.json");
const storageChangeListeners = new Set();

function withCallback(promise, callback) {
  if (typeof callback === "function") {
    promise.then((value) => callback(value));
  }
  return promise;
}

function createStorageArea(area) {
  return {
    get(keys, callback) {
      return withCallback(
        ipcRenderer.invoke("easyTicker:storage:get", area, keys),
        callback
      );
    },
    set(items, callback) {
      return withCallback(
        ipcRenderer.invoke("easyTicker:storage:set", area, items),
        callback
      );
    },
    remove(keys, callback) {
      return withCallback(
        ipcRenderer.invoke("easyTicker:storage:remove", area, keys),
        callback
      );
    },
    clear(callback) {
      return withCallback(
        ipcRenderer.invoke("easyTicker:storage:clear", area),
        callback
      );
    },
  };
}

const chromeApi = {
  runtime: {
    getManifest() {
      return {
        name: manifest.name,
        version: manifest.version,
      };
    },
    getURL(assetPath) {
      return new URL(assetPath, window.location.href).toString();
    },
    openOptionsPage() {
      return ipcRenderer.invoke("easyTicker:window:open-options");
    },
  },
  storage: {
    local: createStorageArea("local"),
    sync: createStorageArea("sync"),
    onChanged: {
      addListener(listener) {
        if (typeof listener === "function") {
          storageChangeListeners.add(listener);
        }
      },
      removeListener(listener) {
        storageChangeListeners.delete(listener);
      },
      hasListener(listener) {
        return storageChangeListeners.has(listener);
      },
    },
  },
};

ipcRenderer.on("easyTicker:storage:changed", (_event, changes, area) => {
  storageChangeListeners.forEach((listener) => listener(changes, area));
});

contextBridge.exposeInMainWorld("easyTickerChrome", chromeApi);

contextBridge.exposeInMainWorld("easyTickerDesktop", {
  isDesktop: true,
  beginDrag(point) {
    ipcRenderer.send("easyTicker:window:drag-start", point);
  },
  moveDrag(point) {
    ipcRenderer.send("easyTicker:window:drag-move", point);
  },
  endDrag() {
    ipcRenderer.send("easyTicker:window:drag-end");
  },
});

window.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("desktop-app");
});
