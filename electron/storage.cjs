const fs = require("fs");
const path = require("path");

const AREAS = new Set(["sync", "local"]);

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function hasChanged(oldValue, newValue) {
  return JSON.stringify(oldValue) !== JSON.stringify(newValue);
}

function normalizeStore(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    sync: source.sync && typeof source.sync === "object" ? source.sync : {},
    local: source.local && typeof source.local === "object" ? source.local : {},
  };
}

function createStorage(filePath) {
  let store;

  function load() {
    if (store) return;
    try {
      store = normalizeStore(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch {
      store = normalizeStore();
    }
  }

  function save() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
  }

  function getArea(areaName) {
    if (!AREAS.has(areaName)) {
      throw new Error(`Unsupported storage area: ${areaName}`);
    }
    load();
    return store[areaName];
  }

  function get(areaName, keys) {
    const area = getArea(areaName);
    if (keys == null) return clone(area);

    if (typeof keys === "string") {
      return Object.prototype.hasOwnProperty.call(area, keys)
        ? { [keys]: clone(area[keys]) }
        : {};
    }

    if (Array.isArray(keys)) {
      return keys.reduce((result, key) => {
        if (Object.prototype.hasOwnProperty.call(area, key)) {
          result[key] = clone(area[key]);
        }
        return result;
      }, {});
    }

    if (typeof keys === "object") {
      return Object.entries(keys).reduce((result, [key, defaultValue]) => {
        result[key] = Object.prototype.hasOwnProperty.call(area, key)
          ? clone(area[key])
          : clone(defaultValue);
        return result;
      }, {});
    }

    return {};
  }

  function set(areaName, items) {
    const area = getArea(areaName);
    const changes = {};
    Object.entries(items || {}).forEach(([key, value]) => {
      const oldValue = clone(area[key]);
      const newValue = clone(value);
      if (hasChanged(oldValue, newValue)) {
        changes[key] = { oldValue, newValue };
      }
      area[key] = newValue;
    });
    if (Object.keys(changes).length) save();
    return changes;
  }

  function remove(areaName, keys) {
    const area = getArea(areaName);
    const changes = {};
    const list = Array.isArray(keys) ? keys : [keys];
    list.filter(Boolean).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(area, key)) {
        changes[key] = { oldValue: clone(area[key]) };
        delete area[key];
      }
    });
    if (Object.keys(changes).length) save();
    return changes;
  }

  function clear(areaName) {
    const area = getArea(areaName);
    const changes = Object.entries(area).reduce((result, [key, value]) => {
      result[key] = { oldValue: clone(value) };
      return result;
    }, {});
    store[areaName] = {};
    if (Object.keys(changes).length) save();
    return changes;
  }

  return {
    clear,
    get,
    remove,
    set,
    dump() {
      load();
      return clone(store);
    },
  };
}

module.exports = { createStorage };
