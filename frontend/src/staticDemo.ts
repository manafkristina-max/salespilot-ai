// Online demo without a server: the real Python backend (FastAPI + SQLite + Harvey
// modules) runs in the visitor's browser on Pyodide (Python compiled to WebAssembly).
// Enabled only in the static build (VITE_STATIC_DEMO=1); the regular app talks to the
// server over HTTP. Each visitor gets a private database kept in IndexedDB.

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
// Pinned: versions verified to work with Pyodide 0.27.7 (pydantic 2.10.5 is bundled).
const PACKAGES = ["fastapi==0.115.6", "starlette==0.41.3", "python-multipart==0.0.33", "httpx==0.28.1"];

type Pyodide = {
  FS: {
    mkdirTree: (p: string) => void;
    mount: (fs: unknown, opts: object, p: string) => void;
    filesystems: { IDBFS: unknown };
    syncfs: (populate: boolean, cb: (err: unknown) => void) => void;
  };
  loadPackage: (names: string[]) => Promise<void>;
  pyimport: (name: string) => { install: (pkgs: string[]) => Promise<void> };
  unpackArchive: (buf: ArrayBuffer, format: string, opts: { extractDir: string }) => void;
  runPythonAsync: (code: string) => Promise<unknown>;
  globals: { get: (name: string) => (...args: unknown[]) => Promise<{ toJs: () => [number, string, string] }> };
};

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<Pyodide>;
    __spFetch?: typeof browserFetch;
  }
}

const BOOT = `
import json, os, shutil, sys
if not os.path.exists("/app/vendor/harvey/harvey"):
    os.makedirs("/app/vendor/harvey", exist_ok=True)
    shutil.move("/app/harvey", "/app/vendor/harvey/harvey")
sys.path.insert(0, "/app/backend")
os.environ["SALESPILOT_DB"] = SP_DB_PATH
os.environ["SALESPILOT_SEED_ON_START"] = "true"

# WebAssembly has no threads: run FastAPI's sync endpoints inline instead of in a pool.
import fastapi.routing, fastapi.dependencies.utils, starlette.concurrency, starlette.datastructures
async def _inline(func, *args, **kwargs):
    return func(*args, **kwargs)
for _m in (fastapi.routing, fastapi.dependencies.utils, starlette.concurrency, starlette.datastructures):
    if hasattr(_m, "run_in_threadpool"):
        _m.run_in_threadpool = _inline

from urllib.parse import urlsplit
from salespilot.api import create_app
_app = create_app()

async def sp_call(method, url, body, content_type):
    u = urlsplit(url)
    data = body.to_bytes() if body is not None else b""
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method,
             "scheme": "https", "path": u.path, "raw_path": u.path.encode(), "query_string": u.query.encode(),
             "root_path": "", "server": ("browser", 443), "client": ("127.0.0.1", 0),
             "headers": [(b"host", b"browser"), (b"content-type", content_type.encode()),
                         (b"content-length", str(len(data)).encode())]}
    done = False
    async def receive():
        nonlocal done
        if done:
            return {"type": "http.disconnect"}
        done = True
        return {"type": "http.request", "body": data, "more_body": False}
    out = {"status": 500, "headers": {}, "body": b""}
    async def send(msg):
        if msg["type"] == "http.response.start":
            out["status"] = msg["status"]
            out["headers"] = {k.decode(): v.decode() for k, v in msg.get("headers", [])}
        elif msg["type"] == "http.response.body":
            out["body"] += msg.get("body", b"")
    await _app(scope, receive, send)
    return out["status"], json.dumps(out["headers"]), out["body"].decode("utf-8", "replace")
`;

let py: Pyodide | null = null;
let call: ((...a: unknown[]) => Promise<{ toJs: () => [number, string, string] }>) | null = null;
let persistent = false;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Не удалось загрузить Python (Pyodide). Проверьте интернет-соединение."));
    document.head.appendChild(s);
  });
}

function syncfs(populate: boolean) {
  return new Promise<void>((resolve, reject) => py!.FS.syncfs(populate, (e) => (e ? reject(e) : resolve())));
}

// One IndexedDB sync at a time; changes made meanwhile are flushed by one follow-up sync.
let syncing: Promise<void> | null = null;
let dirty = false;
function persistSoon() {
  if (!persistent) return;
  if (syncing) { dirty = true; return; }
  syncing = syncfs(false).catch(() => {}).finally(() => {
    syncing = null;
    if (dirty) { dirty = false; persistSoon(); }
  });
}

export async function boot(progress: (msg: string) => void): Promise<{ persistent: boolean }> {
  progress("Загружаю Python в браузер (WebAssembly)…");
  await loadScript(PYODIDE_URL + "pyodide.js");
  py = await window.loadPyodide!({ indexURL: PYODIDE_URL });
  progress("Устанавливаю FastAPI и зависимости…");
  await py.loadPackage(["micropip", "sqlite3", "pydantic"]);
  await py.pyimport("micropip").install(PACKAGES);
  progress("Загружаю backend SalesPilot и модули Harvey…");
  const res = await fetch(new URL("backend.zip", document.baseURI));
  if (!res.ok) throw new Error(`backend.zip: HTTP ${res.status}`);
  py.unpackArchive(await res.arrayBuffer(), "zip", { extractDir: "/app" });
  let dbPath = "/tmp/salespilot.db";
  try {
    py.FS.mkdirTree("/data");
    py.FS.mount(py.FS.filesystems.IDBFS, {}, "/data");
    await syncfs(true);
    dbPath = "/data/salespilot.db";
    persistent = true;
  } catch {
    persistent = false; // private mode / storage blocked: data lives until the tab closes
  }
  progress("Запускаю агентов на демо-данных…");
  await py.runPythonAsync(`SP_DB_PATH = ${JSON.stringify(dbPath)}\n${BOOT}`);
  call = py.globals.get("sp_call");
  if (persistent) await syncfs(false);
  window.__spFetch = browserFetch;
  return { persistent };
}

export async function browserFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!call) throw new Error("Backend ещё не запущен");
  const method = (init.method || "GET").toUpperCase();
  let body: Uint8Array | null = null;
  let contentType = "application/json";
  if (init.body instanceof FormData) {
    const encoded = new Response(init.body); // browser builds the multipart body and boundary
    body = new Uint8Array(await encoded.arrayBuffer());
    contentType = encoded.headers.get("content-type") || "multipart/form-data";
  } else if (typeof init.body === "string") {
    body = new TextEncoder().encode(init.body);
  }
  const [status, headers, text] = (await call(method, url, body, contentType)).toJs();
  if (method !== "GET") persistSoon();
  return new Response(status === 204 ? null : text, { status, headers: JSON.parse(headers) });
}

// Export buttons are plain links to /api/export/*.csv: serve them from the in-browser backend.
document.addEventListener("click", async (ev) => {
  const a = (ev.target as HTMLElement | null)?.closest?.("a");
  const href = a?.getAttribute("href") || "";
  if (!href.startsWith("/api/")) return;
  ev.preventDefault();
  const res = await browserFetch(href);
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || "export.csv";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await res.blob());
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}, true);
