/* Browser demo mock — IndexedDB-backed. Not used inside real WebXDC hosts. */
// IndexedDB-backed mock `webxdc.js` for browser / Vite development.
// Replaces the stock @webxdc/vite-plugins mock that stored the full status
// history in localStorage (QuotaExceededError on large docs / imports).
//
// In a real WebXDC host (Delta Chat) this file is not used.
// See https://docs.webxdc.org/spec.html#webxdc-api

// @ts-check
/** @typedef {import('@webxdc/types/global')} */

/** @type {import('@webxdc/types').Webxdc<any>} */
window.webxdc = (() => {
  const IDB_NAME = "webxdc-mock-idb";
  const IDB_VERSION = 1;
  const STORE_UPDATES = "updates";
  const LEGACY_LS_UPDATES = "__xdcUpdatesKey__";
  const LEGACY_LS_EPHEMERAL = "__xdcEphemeralUpdateKey__";
  const BC_UPDATES = "webxdc-mock-updates";
  const BC_REALTIME = "webxdc-mock-realtime";

  function h(tag, attributes, ...children) {
    const element = document.createElement(tag);
    if (attributes) {
      Object.entries(attributes).forEach((entry) => {
        element.setAttribute(entry[0], entry[1]);
      });
    }
    element.append(...children);
    return element;
  }

  let appIcon = undefined;
  async function getIcon() {
    if (appIcon) return appIcon;
    const img = new Image();
    try {
      img.src = "icon.png";
      await img.decode();
      appIcon = "icon.png";
    } catch {
      img.src = "icon.jpg";
      try {
        await img.decode();
        appIcon = "icon.jpg";
      } catch {
        // ignore
      }
    }
    return appIcon;
  }
  getIcon();

  // ── IndexedDB ────────────────────────────────────────────────────────────

  /** @type {IDBDatabase | null} */
  let db = null;
  /** @type {Promise<IDBDatabase> | null} */
  let dbPromise = null;

  function openDb() {
    if (db) return Promise.resolve(db);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE_UPDATES)) {
          database.createObjectStore(STORE_UPDATES, { keyPath: "serial" });
        }
      };
      req.onsuccess = () => {
        db = req.result;
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error("IDB open failed"));
    });
    return dbPromise;
  }

  /**
   * @returns {Promise<any[]>}
   */
  async function idbGetAllUpdates() {
    const database = await openDb();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_UPDATES, "readonly");
      const store = tx.objectStore(STORE_UPDATES);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = Array.isArray(req.result) ? req.result : [];
        list.sort((a, b) => (a.serial || 0) - (b.serial || 0));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * @param {any} update
   */
  async function idbPutUpdate(update) {
    const database = await openDb();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_UPDATES, "readwrite");
      tx.objectStore(STORE_UPDATES).put(update);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbClearUpdates() {
    const database = await openDb();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_UPDATES, "readwrite");
      tx.objectStore(STORE_UPDATES).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * @param {any[]} updates
   */
  async function idbReplaceAll(updates) {
    const database = await openDb();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_UPDATES, "readwrite");
      const store = tx.objectStore(STORE_UPDATES);
      store.clear();
      for (const u of updates) store.put(u);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ── In-memory status history (sync API) + IDB persistence ────────────────

  /** @type {any[]} */
  let updates = [];
  let updatesReady = false;
  /** @type {Promise<void> | null} */
  let readyPromise = null;

  function migrateLegacyLocalStorage() {
    try {
      const raw = localStorage.getItem(LEGACY_LS_UPDATES);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        localStorage.removeItem(LEGACY_LS_UPDATES);
        return null;
      }
      localStorage.removeItem(LEGACY_LS_UPDATES);
      localStorage.removeItem(LEGACY_LS_EPHEMERAL);
      console.info(
        "[Webxdc] migrated",
        parsed.length,
        "status updates from localStorage → IndexedDB",
      );
      return parsed;
    } catch {
      try {
        localStorage.removeItem(LEGACY_LS_UPDATES);
        localStorage.removeItem(LEGACY_LS_EPHEMERAL);
      } catch {
        // ignore
      }
      return null;
    }
  }

  function ensureReady() {
    if (updatesReady) return Promise.resolve();
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      try {
        const legacy = migrateLegacyLocalStorage();
        if (legacy) {
          updates = legacy.map((u, i) => ({
            ...u,
            serial: u.serial || i + 1,
          }));
          await idbReplaceAll(updates);
        } else {
          updates = await idbGetAllUpdates();
        }
      } catch (error) {
        console.warn("[Webxdc] IndexedDB load failed; starting empty", error);
        updates = [];
      }
      updatesReady = true;
    })();
    return readyPromise;
  }

  // Kick off load immediately.
  ensureReady();

  /** @type {(update: any) => void} */
  let updateListener = (_) => {};

  /**
   * @typedef {import('@webxdc/types').RealtimeListener} RT
   * @type {RT | null}
   */
  let realtimeListener = null;

  /** @type {BroadcastChannel | null} */
  let updatesChannel = null;
  /** @type {BroadcastChannel | null} */
  let realtimeChannel = null;

  try {
    updatesChannel = new BroadcastChannel(BC_UPDATES);
    updatesChannel.onmessage = (event) => {
      const update = event.data;
      if (!update || typeof update.serial !== "number") return;
      if (updates.some((u) => u.serial === update.serial)) return;
      updates.push(update);
      updates.sort((a, b) => a.serial - b.serial);
      void idbPutUpdate(update).catch(() => {});
      update.max_serial = updates.length;
      if (update.notify && update._sender !== window.webxdc.selfAddr) {
        if (update.notify[window.webxdc.selfAddr]) {
          void sendNotification(update.notify[window.webxdc.selfAddr]);
        } else if (update.notify["*"]) {
          void sendNotification(update.notify["*"]);
        }
      }
      updateListener(update);
    };
  } catch {
    updatesChannel = null;
  }

  try {
    realtimeChannel = new BroadcastChannel(BC_REALTIME);
    realtimeChannel.onmessage = (event) => {
      const msg = event.data;
      if (!msg || msg.sender === window.webxdc.selfAddr) return;
      if (
        realtimeListener &&
        // @ts-ignore private
        !realtimeListener.is_trashed()
      ) {
        const raw = msg.data;
        const bytes =
          raw instanceof Uint8Array
            ? raw
            : Array.isArray(raw)
              ? Uint8Array.from(raw)
              : raw?.buffer
                ? new Uint8Array(raw.buffer || raw)
                : null;
        if (!bytes) return;
        // @ts-ignore private
        realtimeListener.receive(bytes);
      }
    };
  } catch {
    realtimeChannel = null;
  }

  /**
   * @type {RT}
   */
  class RealtimeListener {
    constructor() {
      /** @private */
      this.listener = null;
      /** @private */
      this.trashed = false;
      /** @private — buffer until setListener so early peer bytes are not lost */
      this.pending = [];
    }

    is_trashed() {
      return this.trashed;
    }

    receive(data) {
      if (this.trashed) {
        throw new Error(
          "realtime listener is trashed and can no longer be used",
        );
      }
      if (this.listener) {
        this.listener(data);
      } else {
        this.pending.push(data);
        if (this.pending.length > 64) this.pending.shift();
      }
    }

    setListener(listener) {
      this.listener = listener;
      if (listener && this.pending.length) {
        const queued = this.pending.splice(0, this.pending.length);
        for (const data of queued) {
          try {
            listener(data);
          } catch (err) {
            console.warn("[webxdc-mock] realtime pending delivery failed", err);
          }
        }
      }
    }

    send(data) {
      if (!(data instanceof Uint8Array)) {
        throw new Error("realtime listener data must be a Uint8Array");
      }
      // IndexedDB / BroadcastChannel — never localStorage.
      // Post Uint8Array directly (structured clone) — Array.from was slow + lossy.
      if (realtimeChannel) {
        realtimeChannel.postMessage({
          sender: window.webxdc.selfAddr,
          data,
          t: Date.now(),
        });
      }
    }

    leave() {
      this.trashed = true;
      this.listener = null;
      this.pending = [];
      if (realtimeListener === this) {
        realtimeListener = null;
      }
    }
  }

  async function sendNotification(text) {
    console.log("[NOTIFICATION] " + text);
    const opts = { body: text, icon: await getIcon() };
    const title = "To: " + window.webxdc.selfName;
    try {
      if (Notification.permission === "granted") {
        new Notification(title, opts);
      } else if (Notification.permission !== "denied") {
        const perm = await Notification.requestPermission();
        if (perm === "granted") new Notification(title, opts);
      }
    } catch {
      // ignore
    }
  }

  const params = new URLSearchParams(window.location.hash.substr(1));
  const selfAddr = params.get("addr") || "device0@local.host";

  return {
    sendUpdateInterval: 1000,
    sendUpdateMaxSize: 999999,
    /** App detects browser/Pages demo vs real Delta Chat host. */
    // @ts-ignore mock marker
    __xeditorBrowserMock: true,
    selfAddr,
    selfName: params.get("name") || "device0",
    // @ts-ignore mock helpers
    isAppSender: selfAddr === "device0@local.host",
    // @ts-ignore mock helpers
    isBroadcast: false,

    /**
     * Clear durable mock history (IndexedDB). Useful after huge imports in dev.
     */
    // @ts-ignore mock helper
    __clearMockUpdates: async () => {
      updates = [];
      try {
        await idbClearUpdates();
      } catch {
        // ignore
      }
      try {
        localStorage.removeItem(LEGACY_LS_UPDATES);
        localStorage.removeItem(LEGACY_LS_EPHEMERAL);
      } catch {
        // ignore
      }
    },

    setUpdateListener: (cb, serial = 0) => {
      return ensureReady().then(() => {
        const maxSerial = updates.length
          ? updates[updates.length - 1].serial
          : 0;
        for (const update of updates) {
          if (update.serial > serial) {
            update.max_serial = maxSerial;
            cb(update);
          }
        }
        updateListener = cb;
      });
    },

    joinRealtimeChannel: () => {
      // Replace a trashed/stale listener immediately.
      // Do NOT delay 500ms (stock mock did) — that drops all early Yjs handshakes
      // and makes "realtime sync" look broken in multi-tab / webxdc-dev.
      // @ts-ignore private
      if (realtimeListener && !realtimeListener.is_trashed()) {
        try {
          // @ts-ignore private
          realtimeListener.leave();
        } catch {
          // ignore
        }
      }
      const rt = new RealtimeListener();
      realtimeListener = rt;
      return rt;
    },

    getAllUpdates: () => {
      console.log("[Webxdc] WARNING: getAllUpdates() is deprecated.");
      return Promise.resolve([]);
    },

    sendUpdate: (update) => {
      // Keep the public API synchronous: mutate memory, notify, persist async.
      const serial = (updates[updates.length - 1]?.serial || 0) + 1;
      const _update = {
        payload: update.payload,
        summary: update.summary,
        info: update.info,
        notify: update.notify,
        href: update.href,
        document: update.document,
        serial,
        _sender: selfAddr,
      };
      console.log(`[Webxdc] serial=${serial}`);
      updates.push(_update);
      _update.max_serial = serial;
      updateListener(_update);

      void ensureReady()
        .then(() => idbPutUpdate(_update))
        .catch((error) => {
          console.warn("[Webxdc] IndexedDB persist failed", error);
        });

      if (updatesChannel) {
        try {
          updatesChannel.postMessage(_update);
        } catch {
          // ignore
        }
      }
    },

    sendToChat: async (content) => {
      if (!content.file && !content.text) {
        alert("🚨 Error: either file or text need to be set. (or both)");
        return Promise.reject(
          "Error from sendToChat: either file or text need to be set",
        );
      }

      /** @type {(file: Blob) => Promise<string>} */
      const blob_to_base64 = (file) => {
        const data_start = ";base64,";
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => {
            /** @type {string} */
            // @ts-ignore
            let data = reader.result;
            resolve(data.slice(data.indexOf(data_start) + data_start.length));
          };
          reader.onerror = () => reject(reader.error);
        });
      };

      let base64Content = "";
      if (content.file) {
        if (!content.file.name) {
          return Promise.reject("file name is missing");
        }
        if (
          Object.keys(content.file).filter((key) =>
            ["blob", "base64", "plainText"].includes(key),
          ).length > 1
        ) {
          return Promise.reject(
            "you can only set one of `blob`, `base64` or `plainText`, not multiple ones",
          );
        }

        // @ts-ignore
        if (content.file.blob instanceof Blob) {
          // @ts-ignore
          base64Content = await blob_to_base64(content.file.blob);
          // @ts-ignore
        } else if (typeof content.file.base64 === "string") {
          // @ts-ignore
          base64Content = content.file.base64;
          // @ts-ignore
        } else if (typeof content.file.plainText === "string") {
          base64Content = await blob_to_base64(
            // @ts-ignore
            new Blob([content.file.plainText]),
          );
        } else {
          return Promise.reject(
            "data is not set or wrong format, set one of `blob`, `base64` or `plainText`",
          );
        }
      }

      const msg = `The app would now close and the user would select a chat to send this message:\nText: ${
        content.text ? `"${content.text}"` : "No Text"
      }\nFile: ${
        content.file
          ? `${content.file.name} - ${base64Content.length} bytes`
          : "No File"
      }`;
      if (content.file) {
        const confirmed = confirm(
          msg + "\n\nDownload the file in the browser instead?",
        );
        if (confirmed) {
          const dataURL =
            "data:application/octet-stream;base64," + base64Content;
          const element = h("a", {
            href: dataURL,
            download: content.file.name,
          });
          document.body.appendChild(element);
          element.click();
          document.body.removeChild(element);
        }
      } else {
        alert(msg);
      }
    },

    importFiles: (filters) => {
      const accept = [
        ...(filters.extensions || []),
        ...(filters.mimeTypes || []),
      ].join(",");
      const element = h("input", {
        type: "file",
        accept,
        multiple: filters.multiple || false,
      });
      const promise = new Promise((resolve) => {
        element.onchange = () => {
          const files = Array.from(element.files || []);
          document.body.removeChild(element);
          resolve(files);
        };
      });
      element.style.display = "none";
      document.body.appendChild(element);
      element.click();
      return promise;
    },
  };
})();
