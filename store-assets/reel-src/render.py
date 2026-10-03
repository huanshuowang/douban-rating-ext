"""Deterministic frame renderer: drives reel.html's renderAt(t) over CDP and screenshots each sample.

usage:
  render.py preview OUTDIR t1 t2 ...          -> OUTDIR/p_<t>.png
  render.py frames OUTDIR WORKER NWORKERS     -> OUTDIR/s_<idx>.jpg  (FPS * SUB samples / second)
"""
import base64, json, os, subprocess, sys, time, urllib.request
import websocket

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FPS, SUB, SHUTTER = 60, 4, 0.5          # 4 samples per frame across a 180° shutter
DURATION = float(os.environ.get("DUR", "29.5"))


class Page:
    def __init__(self, port):
        self.prof = f"/tmp/reel-chrome-{port}"
        self.proc = subprocess.Popen([
            CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={self.prof}",
            "--window-size=1920,1080", "--hide-scrollbars", "--force-device-scale-factor=1",
            "--no-first-run", "--no-default-browser-check", "--disable-extensions",
            "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
            "--disable-backgrounding-occluded-windows", "--allow-file-access-from-files", "--remote-allow-origins=*", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(200):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
                page = [t for t in tabs if t["type"] == "page"][0]
                break
            except Exception:
                time.sleep(0.1)
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], suppress_origin=True)
        self.i = 0

    def call(self, method, **params):
        self.i += 1
        self.ws.send(json.dumps({"id": self.i, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.i:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def js(self, expr):
        r = self.call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in r:
            raise RuntimeError(json.dumps(r["exceptionDetails"])[:800])
        return r.get("result", {}).get("value")

    def open(self):
        self.call("Emulation.setDeviceMetricsOverride", width=1920, height=1080, deviceScaleFactor=1, mobile=False)
        self.call("Page.enable")
        self.call("Page.navigate", url="file://" + os.path.join(HERE, "reel.html") + os.environ.get("QS", ""))
        for _ in range(600):
            try:
                if self.js("window.READY === true"):
                    return
            except Exception:
                pass
            time.sleep(0.1)
        raise RuntimeError("page never became READY")

    def shot(self, t, path, fmt="jpeg"):
        self.js(f"renderAt({t:.6f})")
        kw = {"format": fmt, "captureBeyondViewport": False, "optimizeForSpeed": True}
        if fmt == "jpeg":
            kw["quality"] = 95
        data = self.call("Page.captureScreenshot", **kw)["data"]
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))

    def close(self):
        try:
            self.ws.close()
        finally:
            self.proc.terminate()


def main():
    mode, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    if mode == "preview":
        p = Page(9400)
        p.open()
        for ts in sys.argv[3:]:
            p.shot(float(ts), os.path.join(out, f"p_{float(ts):06.2f}.png"), fmt="png")
        p.close()
        return
    w, n = int(sys.argv[3]), int(sys.argv[4])
    frames = int(round(DURATION * FPS))
    lo, hi = frames * w // n, frames * (w + 1) // n
    # optional re-render window (seconds) — overwrites existing samples inside it
    t0w, t1w = float(os.environ.get("T0", "-1")), float(os.environ.get("T1", "-1"))
    force = t0w >= 0
    t0 = time.time()
    for attempt in range(20):
        try:
            p = Page(int(os.environ.get("PORTBASE", "9410")) + w + 10 * attempt)
            p.open()
            run(p, w, lo, hi, out, t0, t0w, t1w, force)
            p.close()
            return
        except Exception as e:
            print(f"[w{w}] restart after error: {e!r}", flush=True)
            try:
                p.close()
            except Exception:
                pass
            time.sleep(1)


def run(p, w, lo, hi, out, t0, t0w, t1w, force):
    for f in range(lo, hi):
        for k in range(SUB):
            idx = f * SUB + k
            path = os.path.join(out, f"s_{idx:06d}.jpg")
            if force and not (t0w <= f / FPS <= t1w):
                continue
            if not force and os.path.exists(path):
                continue
            off = ((k + 0.5) / SUB - 0.5) * SHUTTER
            p.shot(max(0.0, (f + off) / FPS), path)
        if (f - lo) % 60 == 0:
            el = time.time() - t0
            print(f"[w{w}] frame {f}/{hi}  {el:.0f}s", flush=True)


if __name__ == "__main__":
    main()
