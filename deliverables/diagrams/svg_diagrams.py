"""Generates the two hand-laid-out diagrams (system design, deployment) as SVG.

Mermaid cannot place boxes on a fixed grid, so these two are drawn directly.
Run:  python svg_diagrams.py   -> writes fig09-system-design.svg, fig14-deployment.svg
"""
from xml.sax.saxutils import escape

FONT = "Arial, Helvetica, sans-serif"
INK = "#1f2933"
LINE = "#52606d"

FILLS = {
    "client": "#e8f1fb", "server": "#e9f6ec", "data": "#fdf3d8", "queue": "#fde8e4",
    "worker": "#efe9fb", "ext": "#f1f3f5", "note": "#ffffff",
}


class Svg:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.parts = []

    def group(self, x, y, w, h, title, tag=None):
        self.parts.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="#fbfcfd" '
            f'stroke="{LINE}" stroke-width="1.5" stroke-dasharray="7 5"/>')
        ty = y + 24
        if tag:
            self.parts.append(self._text(x + 14, ty, f"«{tag}»", 14, italic=True, anchor="start", fill="#52606d"))
            ty += 20
        self.parts.append(self._text(x + 14, ty, title, 17, bold=True, anchor="start"))

    def box(self, x, y, w, h, title, lines=(), kind="server", tag=None, size=16):
        self.parts.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{FILLS[kind]}" '
            f'stroke="{INK}" stroke-width="1.5"/>')
        rows = ([("tag", f"«{tag}»")] if tag else []) + [("title", title)] + [("line", l) for l in lines]
        heights = {"tag": 17, "title": 21, "line": 20}
        total = sum(heights[k] for k, _ in rows)
        cy = y + (h - total) / 2
        for k, t in rows:
            cy += heights[k]
            if k == "tag":
                self.parts.append(self._text(x + w / 2, cy - 5, t, 13, italic=True, fill="#52606d"))
            elif k == "title":
                self.parts.append(self._text(x + w / 2, cy - 5, t, size + 1, bold=True))
            else:
                self.parts.append(self._text(x + w / 2, cy - 5, t, size - 1))

    def cylinder(self, x, y, w, h, title, lines=(), kind="data", tag=None):
        ry = 11
        self.parts.append(
            f'<path d="M{x},{y + ry} a{w / 2},{ry} 0 0 1 {w},0 v{h - 2 * ry} a{w / 2},{ry} 0 0 1 {-w},0 z" '
            f'fill="{FILLS[kind]}" stroke="{INK}" stroke-width="1.5"/>'
            f'<path d="M{x},{y + ry} a{w / 2},{ry} 0 0 0 {w},0" fill="none" stroke="{INK}" stroke-width="1.5"/>')
        rows = ([f"«{tag}»"] if tag else []) + [title] + list(lines)
        cy = y + ry + (h - ry - len(rows) * 20) / 2 + 6
        for i, t in enumerate(rows):
            cy += 20
            is_tag = tag and i == 0
            is_title = (i == 1) if tag else (i == 0)
            self.parts.append(self._text(x + w / 2, cy - 6, t, 13 if is_tag else (16 if is_title else 15),
                                         bold=is_title, italic=bool(is_tag),
                                         fill="#52606d" if is_tag else INK))

    def arrow(self, pts, dashed=False, both=False):
        d = "M" + " L".join(f"{x},{y}" for x, y in pts)
        dash = ' stroke-dasharray="6 5"' if dashed else ""
        start = ' marker-start="url(#ah2)"' if both else ""
        self.parts.append(
            f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="1.8"{dash} marker-end="url(#ah)"{start}/>')

    def label(self, x, y, text, anchor="middle", size=14, num=None):
        lines = text.split("\n")
        if num is not None:
            self.parts.append(f'<circle cx="{x}" cy="{y - 5}" r="12" fill="{INK}"/>')
            self.parts.append(self._text(x, y, str(num), 14, bold=True, fill="#ffffff"))
            x += 18 if anchor == "start" else 0
            if anchor != "start":
                y += 24
        for i, l in enumerate(lines):
            ly = y + i * 17
            wpx = len(l) * size * 0.54 + 8
            bx = x - 4 if anchor == "start" else (x - wpx / 2 if anchor == "middle" else x - wpx + 4)
            self.parts.append(f'<rect x="{bx:.0f}" y="{ly - size}" width="{wpx:.0f}" height="{size + 5}" fill="#ffffff" opacity="0.9"/>')
            self.parts.append(self._text(x, ly, l, size, anchor=anchor))

    def num(self, x, y, n):
        self.parts.append(f'<circle cx="{x}" cy="{y}" r="13" fill="{INK}" stroke="#ffffff" stroke-width="2"/>')
        self.parts.append(self._text(x, y + 5, str(n), 14, bold=True, fill="#ffffff"))

    def _text(self, x, y, t, size, bold=False, italic=False, anchor="middle", fill=INK):
        w = ' font-weight="bold"' if bold else ""
        i = ' font-style="italic"' if italic else ""
        return (f'<text x="{x:.0f}" y="{y:.0f}" font-family="{FONT}" font-size="{size}"{w}{i} '
                f'text-anchor="{anchor}" fill="{fill}">{escape(t)}</text>')

    def write(self, path):
        defs = (f'<defs><marker id="ah" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">'
                f'<path d="M0,0 L10,4 L0,8 z" fill="{INK}"/></marker>'
                f'<marker id="ah2" markerWidth="10" markerHeight="8" refX="1" refY="4" orient="auto">'
                f'<path d="M10,0 L0,4 L10,8 z" fill="{INK}"/></marker></defs>')
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
               f'viewBox="0 0 {self.w} {self.h}"><rect width="100%" height="100%" fill="#ffffff"/>'
               f'{defs}{"".join(self.parts)}</svg>')
        with open(path, "w") as f:
            f.write(svg)


def system_design():
    s = Svg(1260, 900)

    # --- client ---------------------------------------------------------
    s.box(40, 20, 270, 54, "Reddit / X servers", kind="ext")
    s.group(20, 110, 310, 600, "User's browser (Chrome)")
    s.box(40, 160, 270, 100, "Page context", ["injected.js: fetch / XHR override", "DomProcessor, StyleManager"], kind="client")
    s.box(40, 330, 270, 76, "Content script", ["isolated world, ApiService"], kind="client")
    s.box(40, 470, 270, 76, "Service worker", ["user_id, settings, sign-in"], kind="client")
    s.box(40, 610, 270, 76, "Popup and Options pages", ["filter chat, filter list, settings"], kind="client")

    # --- API server -----------------------------------------------------
    s.group(450, 110, 400, 440, "Backend API server (FastAPI, port 8001)")
    s.box(470, 160, 360, 96, "Routes (app.py)", ["/get_feed  /filters  /chat  /chat/image", "/get_img_result  /ws/{user_id}"])
    s.box(470, 284, 360, 56, "RedditProcessor / TwitterProcessor")
    s.box(470, 368, 172, 76, "ImageProcessor", ["+ FilterUtils"])
    s.box(658, 368, 172, 76, "LLMProcessor", ["text pipeline"])
    s.box(470, 472, 360, 56, "FilterCreationChat / VisionFilterCreator")

    # --- LLM providers ---------------------------------------------------
    s.group(960, 110, 280, 230, "LLM / VLM providers")
    s.box(980, 160, 240, 70, "OpenAI API", ["GPT-4o, GPT-4o-mini"], kind="ext")
    s.box(980, 250, 240, 70, "Google Gemini API", ["image edit, scoring"], kind="ext")

    # --- data tier -------------------------------------------------------
    s.cylinder(450, 650, 180, 100, "SQLite filters.db", ["users, filters,", "processing_logs"])
    s.box(680, 650, 190, 100, "Redis", ["Celery broker,", "image cache, pub/sub"], kind="queue")
    s.box(960, 650, 280, 100, "Celery worker (gevent)", ["generate candidates,", "score, pick best"], kind="worker")
    s.cylinder(960, 800, 280, 84, "Image storage", ["temp/uploads or AWS S3"])

    # --- arrows (numbers match the walkthrough in the report) ------------
    s.arrow([(240, 74), (240, 160)]);                      s.label(262, 100, "feed response", "start", num=1)
    s.arrow([(110, 260), (110, 330)]);                     s.label(56, 300, "SaveBatch", "start", num=2)
    s.arrow([(250, 330), (250, 260)], dashed=True);        s.label(196, 300, "render", "start", num=7)
    s.arrow([(175, 406), (175, 470)], both=True);          s.label(190, 443, "chrome.runtime", "start", size=13)
    s.arrow([(175, 610), (175, 546)]);                     s.label(190, 583, "chrome.runtime", "start", size=13)

    s.arrow([(310, 340), (470, 180)]);                     s.num(350, 300, 3)
    s.arrow([(470, 208), (310, 368)], dashed=True);        s.num(390, 288, 7)
    s.arrow([(310, 396), (470, 236)], both=True);          s.num(430, 276, 10)
    s.arrow([(310, 648), (470, 500)], both=True);          s.label(332, 556, "filter chat", "start", num="A", size=13)
    s.label(350, 573, "and CRUD", "start", size=13)

    s.arrow([(650, 256), (650, 284)])
    s.arrow([(556, 340), (556, 368)]);                     s.arrow([(744, 340), (744, 368)])
    s.arrow([(830, 400), (980, 200)], both=True);          s.label(905, 380, "text LLM calls", "start", num=5, size=13)
    s.arrow([(830, 490), (980, 222)], dashed=True, both=True)

    s.arrow([(540, 550), (540, 650)], both=True);          s.label(558, 604, "filters", "start", num=4)
    s.arrow([(730, 550), (730, 650)]);                     s.label(676, 604, "enqueue", "start", num=6, size=13)
    s.arrow([(830, 650), (830, 550)], dashed=True);        s.label(848, 604, "cache read", "start", num=10, size=13)
    s.arrow([(870, 680), (960, 680)]);                     s.num(915, 680, 8)
    s.arrow([(960, 725), (870, 725)], dashed=True);        s.num(915, 725, 9)
    s.arrow([(1100, 650), (1100, 340)], both=True);        s.label(1118, 490, "generate and", "start", num=8, size=13)
    s.label(1136, 507, "score images", "start", size=13)
    s.arrow([(1100, 750), (1100, 800)]);                   s.label(1118, 782, "save image", "start", num=9, size=13)

    s.write("fig09-system-design.svg")


def deployment():
    s = Svg(1260, 814)

    s.group(20, 60, 300, 420, "User's machine", tag="device")
    s.group(40, 130, 260, 330, "Google Chrome", tag="execution environment")
    s.box(60, 200, 220, 90, "reddit.com / x.com tab", ["page + injected.js"], kind="client")
    s.box(60, 340, 220, 100, "SHIELD extension", ["BrowserExtension/dist", "(MV3, load unpacked)"], kind="client", tag="artifact")

    s.group(420, 20, 520, 774, "Docker host (docker compose project)", tag="device")
    s.group(440, 90, 480, 420, "compose network: shield-net", tag="execution environment")
    s.box(460, 160, 440, 100, "api", ["image: python:3.11-slim + requirements.txt", "command: python app.py  |  ports: 8001:8001"], tag="container")
    s.box(460, 290, 440, 100, "worker", ["same image as api", "celery -A celery_gevent_worker worker -P gevent"], kind="worker", tag="container")
    s.box(460, 420, 440, 72, "redis", ["image: redis:7-alpine  |  port 6379 (internal)"], kind="queue", tag="container")

    s.cylinder(440, 560, 150, 96, "shield-db", ["filters.db"], tag="volume")
    s.cylinder(605, 560, 150, 96, "shield-uploads", ["temp/uploads"], tag="volume")
    s.cylinder(770, 560, 150, 96, "shield-requests", ["data/requests"], tag="volume")
    s.box(440, 704, 480, 70, ".env  (env_file for api and worker)", ["OPENAI_API_KEY, GOOGLE_API_KEY, USE_S3, AWS_*"], kind="note", tag="artifact")

    s.group(1020, 60, 220, 420, "External services")
    s.box(1040, 110, 180, 80, "OpenAI API", ["HTTPS"], kind="ext")
    s.box(1040, 230, 180, 80, "Google Gemini API", ["HTTPS"], kind="ext")
    s.box(1040, 350, 180, 100, "AWS S3 bucket", ["optional,", "USE_S3=true"], kind="ext")

    s.arrow([(170, 290), (170, 340)], both=True)
    s.arrow([(280, 380), (360, 380), (360, 210), (460, 210)], both=True)
    s.label(370, 410, "HTTP", size=13); s.label(370, 427, "port 8001", size=13); s.label(370, 444, "(published)", size=13)

    s.arrow([(520, 260), (520, 420)], both=True);     s.label(534, 280, "6379", "start", size=13)
    s.arrow([(840, 390), (840, 420)], both=True)

    s.arrow([(900, 190), (1040, 150)]);
    s.arrow([(900, 330), (1040, 170)])
    s.arrow([(900, 345), (1040, 270)])
    s.arrow([(900, 365), (1040, 400)], dashed=True)

    s.arrow([(480, 510), (480, 560)], dashed=True)
    s.arrow([(680, 510), (680, 560)], dashed=True)
    s.arrow([(845, 510), (845, 560)], dashed=True)
    s.label(680, 682, "all three volumes mount into api; shield-uploads also mounts into worker", size=13)

    s.write("fig14-deployment.svg")


if __name__ == "__main__":
    system_design()
    deployment()
