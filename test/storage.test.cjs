const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createStorage } = require("../electron/storage.cjs");

function createTempStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "easyticker-storage-"));
  return createStorage(path.join(dir, "storage.json"));
}

test("storage get mirrors chrome.storage defaults and key filtering", () => {
  const storage = createTempStorage();
  storage.set("sync", { colorOption: "red-up", refreshInterval: 60000 });

  assert.deepEqual(storage.get("sync", ["colorOption", "missing"]), {
    colorOption: "red-up",
  });
  assert.deepEqual(storage.get("sync", { colorOption: "green-up", language: "zh_CN" }), {
    colorOption: "red-up",
    language: "zh_CN",
  });
  assert.deepEqual(storage.get("sync", null), {
    colorOption: "red-up",
    refreshInterval: 60000,
  });
});

test("storage keeps sync and local areas separate", () => {
  const storage = createTempStorage();
  storage.set("sync", { from_popup: false });
  storage.set("local", { from_popup: true });

  assert.deepEqual(storage.get("sync", "from_popup"), { from_popup: false });
  assert.deepEqual(storage.get("local", "from_popup"), { from_popup: true });
});

test("storage remove and clear persist changes", () => {
  const storage = createTempStorage();
  storage.set("sync", { a: 1, b: 2 });
  const removeChanges = storage.remove("sync", "a");
  assert.deepEqual(removeChanges, { a: { oldValue: 1 } });
  assert.deepEqual(storage.get("sync", null), { b: 2 });

  const clearChanges = storage.clear("sync");
  assert.deepEqual(clearChanges, { b: { oldValue: 2 } });
  assert.deepEqual(storage.get("sync", null), {});
});

test("storage set reports changed old and new values", () => {
  const storage = createTempStorage();
  storage.set("sync", { myStocks: [] });

  const changes = storage.set("sync", {
    myStocks: [{ code: "600519", market: 1, enabled: true }],
  });

  assert.deepEqual(changes, {
    myStocks: {
      oldValue: [],
      newValue: [{ code: "600519", market: 1, enabled: true }],
    },
  });
  assert.deepEqual(storage.set("sync", {
    myStocks: [{ code: "600519", market: 1, enabled: true }],
  }), {});
});
