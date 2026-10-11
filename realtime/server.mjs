import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data", "docs");
const VERSIONS_DIR = path.join(__dirname, "..", "data", "versions");
const PORT = Number(process.env.REALTIME_PORT || process.env.PORT || 1234);
const HOST = process.env.REALTIME_HOST || "0.0.0.0";
const SAVE_DEBOUNCE_MS = 800;
const VERSION_INTERVAL_MS = Number(process.env.REALTIME_VERSION_INTERVAL || 10000);
const MAX_VERSIONS = 15;

/**
 * Custom (room-level) message type shared by client and server:
 * server echoes it to peers and uses it to push chat history.
 */
const messageCustom = 6;

const messageSync = 0;
const messageAwareness = 1;
/** server -> client: reset document contents and reconnect */
const messageReset = 4;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(VERSIONS_DIR, { recursive: true });

/** @type {Map<string, { doc: Y.Doc, awareness: awarenessProtocol.Awareness, chat: Array }>} */
const rooms = new Map();
/** @type {Map<string, NodeJS.Timeout>} */
const saveTimers = new Map();
/** @type {Map<string, number>} */
const lastVersionAt = new Map();

const docPath = (name) => path.join(DATA_DIR, `${encodeURIComponent(name)}.bin`);
const versionDir = (name) => path.join(VERSIONS_DIR, encodeURIComponent(name));

function persistNow(name, doc) {
  try {
    const update = Y.encodeStateAsUpdate(doc);
    const tmp = `${docPath(name)}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(update));
    fs.renameSync(tmp, docPath(name));
    maybeSnapshot(name, doc);
  } catch (err) {
    console.error(`[realtime] failed to persist "${name}":`, err);
  }
}

function scheduleSave(name, doc) {
  const existing = saveTimers.get(name);
  if (existing) clearTimeout(existing);
  saveTimers.set(
    name,
    setTimeout(() => {
      saveTimers.delete(name);
      persistNow(name, doc);
    }, SAVE_DEBOUNCE_MS),
  );
}

function maybeSnapshot(name, doc) {
  const now = Date.now();
  const prev = lastVersionAt.get(name) || 0;
  if (now - prev < VERSION_INTERVAL_MS) return;
  lastVersionAt.set(name, now);
  try {
    const dir = versionDir(name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${now}.bin`),
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    );
    const indexFile = path.join(dir, "index.json");
    let list = [];
    try {
      list = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    } catch {
      /* no index yet */
    }
    if (!Array.isArray(list)) list = [];
    list.push({ epoch: now, time: now });
    list.sort((a, b) => a.epoch - b.epoch);
    if (list.length > MAX_VERSIONS) list.splice(0, list.length - MAX_VERSIONS);
    fs.writeFileSync(indexFile, JSON.stringify(list, null, 2));
  } catch (err) {
    console.error(`[realtime] version snapshot failed for "${name}":`, err);
  }
}

function attachRoomHandlers(name, { doc, awareness }) {
  doc.on("update", (update, origin) => {
    if (origin !== "load") scheduleSave(name, doc);

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    for (const conn of doc.conns.keys()) send(message, conn);
  });

  awareness.on("update", ({ added, updated, removed }, origin) => {
    const changed = added.concat(updated, removed);
    if (origin && doc.conns.has(origin)) {
      const controlled = doc.conns.get(origin);
      added.forEach((id) => controlled.add(id));
      removed.forEach((id) => controlled.delete(id));
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
    );
    const message = encoding.toUint8Array(encoder);
    for (const conn of doc.conns.keys()) send(message, conn);
  });
}

function getRoom(name) {
  const existing = rooms.get(name);
  if (existing) return existing;

  const doc = new Y.Doc({ gc: true });
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);
  doc.conns = new Map();
  doc.awareness = awareness;

  const file = docPath(name);
  if (fs.existsSync(file)) {
    try {
      Y.applyUpdate(doc, new Uint8Array(fs.readFileSync(file)), "load");
    } catch (err) {
      console.error(`[realtime] failed to load "${name}":`, err);
    }
  }

  const room = { doc, awareness, chat: [] };
  attachRoomHandlers(name, room);
  rooms.set(name, room);
  console.log(`[realtime] room "${name}" loaded`);
  return room;
}

function send(message, conn) {
  if (conn.readyState !== 1) {
    conn.close();
    return;
  }
  try {
    conn.send(message);
  } catch {
    conn.close();
  }
}

function closeConn(name, conn) {
  const room = rooms.get(name);
  if (!room) return;
  const { doc, awareness } = room;
  if (doc.conns.has(conn)) {
    const controlled = doc.conns.get(conn);
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(awareness, Array.from(controlled), null);
    if (doc.conns.size === 0) {
      persistNow(name, doc);
      console.log(`[realtime] room "${name}" empty - persisted`);
    }
  }
  conn.close();
}

function restoreVersion(name, epochStr) {
  const epoch = Number(epochStr);
  if (!Number.isFinite(epoch)) return { ok: false, status: 400, error: "Invalid epoch" };

  const room = rooms.get(name) ?? getRoom(name);
  const file = path.join(versionDir(name), `${epoch}.bin`);
  if (!fs.existsSync(file)) return { ok: false, status: 404, error: "Version not found" };

  const pendingSave = saveTimers.get(name);
  if (pendingSave) {
    clearTimeout(pendingSave);
    saveTimers.delete(name);
  }

  const targetBytes = new Uint8Array(fs.readFileSync(file));
  const freshDoc = new Y.Doc({ gc: true });
  Y.applyUpdate(freshDoc, targetBytes, "restore");

  const freshAwareness = new awarenessProtocol.Awareness(freshDoc);
  freshAwareness.setLocalState(null);
  freshDoc.conns = new Map();
  freshDoc.awareness = freshAwareness;

  const oldConns = Array.from(room.doc.conns.keys());

  const newRoom = { doc: freshDoc, awareness: freshAwareness, chat: room.chat };
  attachRoomHandlers(name, newRoom);
  rooms.set(name, newRoom);

  // Reset every connected client: send the full restored state, then close so they reconnect
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageReset);
  encoding.writeVarUint8Array(encoder, Y.encodeStateAsUpdate(freshDoc));
  const resetMsg = encoding.toUint8Array(encoder);
  for (const conn of oldConns) send(resetMsg, conn);
  for (const conn of oldConns) {
    try {
      conn.close();
    } catch {
      /* ignore */
    }
  }

  room.doc.conns = new Map();
  room.doc.awareness = room.awareness;
  try {
    room.doc.destroy();
  } catch {
    /* ignore */
  }
  room.awareness.destroy();

  persistNow(name, freshDoc);
  console.log(`[realtime] room "${name}" restored to version ${epoch}`);
  return { ok: true, version: { epoch } };
}

function onConnection(conn, req) {
  conn.binaryType = "arraybuffer";
  const name = decodeURIComponent((req.url || "/").slice(1).split("?")[0]) || "default";
  const room = getRoom(name);
  const { doc, awareness } = room;

  doc.conns.set(conn, new Set());

  conn.on("message", (data) => {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const encoder = encoding.createEncoder();
      const type = decoding.readVarUint(decoder);

      switch (type) {
        case messageSync:
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
          if (encoding.length(encoder) > 1) {
            send(encoding.toUint8Array(encoder), conn);
          }
          break;
        case messageAwareness:
          awarenessProtocol.applyAwarenessUpdate(
            awareness,
            decoding.readVarUint8Array(decoder),
            conn,
          );
          break;
        default: {
          // Room-level custom payload: keep a small chat buffer, echo to peers
          const payload = decoding.readVarUint8Array(decoder);
          let parsed = null;
          try {
            parsed = JSON.parse(new TextDecoder().decode(payload));
          } catch {
            parsed = null;
          }
          if (parsed && parsed.kind === "chat" && parsed.message) {
            room.chat.push(parsed.message);
            if (room.chat.length > 100) room.chat.splice(0, room.chat.length - 100);
          }
          const broadcast = encoding.createEncoder();
          encoding.writeVarUint(broadcast, type);
          encoding.writeVarUint8Array(broadcast, payload);
          const message = encoding.toUint8Array(broadcast);
          for (const peer of doc.conns.keys()) {
            if (peer !== conn) send(message, peer);
          }
          break;
        }
      }
    } catch (err) {
      console.error(`[realtime] message error on "${name}":`, err);
    }
  });

  conn.on("close", () => closeConn(name, conn));
  conn.on("error", () => closeConn(name, conn));

  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(encoding.toUint8Array(encoder), conn);

    const states = awareness.getStates();
    if (states.size > 0) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, messageAwareness);
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(states.keys())),
      );
      send(encoding.toUint8Array(enc), conn);
    }

    if (room.chat.length > 0) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, messageCustom);
      encoding.writeVarUint8Array(
        enc,
        new TextEncoder().encode(
          JSON.stringify({ kind: "chat", history: room.chat }),
        ),
      );
      send(encoding.toUint8Array(enc), conn);
    }
  }
}

function json(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "POST" && url.pathname === "/restore") {
    const doc = url.searchParams.get("doc");
    const epoch = url.searchParams.get("epoch");
    if (!doc || !epoch) return json(res, 400, { ok: false, error: "doc and epoch required" });
    const result = restoreVersion(doc, epoch);
    return json(res, result.status || 200, result);
  }
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true });
  }
  json(res, 404, { ok: false, error: "Not found" });
});

const wss = new WebSocketServer({ server });
wss.on("connection", onConnection);

server.listen(PORT, HOST, () => {
  console.log(`[realtime] Yjs websocket server running on ws://${HOST}:${PORT}`);
});

server.on("error", (err) => {
  console.error("[realtime] server error:", err);
});

function shutdown() {
  console.log("\n[realtime] shutting down, flushing documents...");
  for (const [name, { doc }] of rooms) persistNow(name, doc);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);