"""Atualiza os arquivos públicos e o snapshot original (não altera .local/).

Executar com Python 3: python scripts/download_reference.py
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re
import urllib.request
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://wrg41y-n2xaqy6l5-arcedawebapps1.vercel.app"
manifest = []
USER_AGENT = "Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36"


def download(url, target):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        content = response.read()
    destination = ROOT / target
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
    manifest.append({"url": url, "file": target, "bytes": len(content), "sha256": sha256(content).hexdigest()})
    return content


def download_font_license(family):
    font_directory = family.lower().replace(" ", "")
    url = "https://raw.githubusercontent.com/google/fonts/main/ofl/" + font_directory + "/OFL.txt"
    return download(url, "docs/font-licenses/" + font_directory + ".txt")


def main():
    html = urllib.request.urlopen(BASE, timeout=60).read().decode()
    js = re.search(r'<script type="module"[^>]+src="([^"]+)"', html)[1]
    css = re.search(r'<link rel="stylesheet"[^>]+href="([^"]+)"', html)[1]
    original = download(BASE + js, "vendor/original-app.js").decode()
    styles = download(BASE + css, "vendor/original-style.css").decode()
    site = {}
    for key in ["home", "theme", "pages", "contact"]:
        content = download(BASE + "/api/" + key, "vendor/api/" + key + ".json")
        site[key] = json.loads(content)
    site["categories"], site["products"] = [], []
    for key in ["menu", "caffetteria", "drink", "vini"]:
        content = download(BASE + "/api/catalog?section=" + key, "vendor/api/catalog-" + key + ".json")
        catalog = json.loads(content)
        site["categories"].extend(catalog["categories"])
        site["products"].extend(catalog["products"])
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data/site.json").write_text(json.dumps(site, ensure_ascii=False, indent=2) + "\n", encoding="utf8", newline="\n")

    paths = {"/favicon.svg", "/img/logo-giannino.png"}
    serialized = json.dumps(site)
    paths.update(re.findall(r'"(/[^"\s]+\.(?:png|jpg|jpeg|webp|svg|mp4))"', serialized))
    for path in sorted(paths):
        download(BASE + path, "public" + path)

    # Todos os tipos de letra oferecidos pelo editor também ficam disponíveis offline.
    families = set()
    for name in ["Gp", "Kp"]:
        match = re.search(name + r'=(\[[^\]]+\])', original)
        families.update(json.loads(match[1]))
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(download_font_license, sorted(families)))
    font_urls = set()
    font_css = []

    def font_family(family):
        query = family.replace(" ", "+")
        url = "https://fonts.googleapis.com/css2?family=" + query + ":ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=60) as response:
                return response.read().decode()
        except urllib.error.HTTPError:
            url = "https://fonts.googleapis.com/css2?family=" + query + "&display=swap"
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=60) as response:
                return response.read().decode()

    with ThreadPoolExecutor(max_workers=6) as pool:
        for result in pool.map(font_family, sorted(families)):
            font_css.append(result)
            font_urls.update(re.findall(r'url\((https://[^)]+)\)', result))
    replacements = {}
    for url in sorted(font_urls):
        ext = Path(urlparse(url).path).suffix
        filename = sha256(url.encode()).hexdigest()[:20] + (ext or ".woff2")
        replacements[url] = "/fonts/" + filename
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda url: download(url, "public" + replacements[url]), sorted(font_urls)))
    css_fonts = "\n".join(font_css)
    for url, local in replacements.items():
        css_fonts = css_fonts.replace(url, local)
    (ROOT / "public/assets/fonts.css").write_text(css_fonts, encoding="utf8", newline="\n")
    styles = re.sub(r'@import"https://fonts.googleapis.com/[^";]+";', "", styles)
    (ROOT / "public/assets/style.css").write_text(styles, encoding="utf8", newline="\n")

    original, count = re.subn(r'const Kr=jS\("https://[^" ]+","[^" ]+",\{auth:\{persistSession:!0,autoRefreshToken:!0\}\}\)', "const Kr=localAuthClient", original)
    if count != 1:
        raise RuntimeError("A interface de autenticação original mudou; revisar adaptação antes de atualizar.")
    original = original.replace('"https://fonts.googleapis.com/css2?"', '"/assets/fonts.css?"')
    (ROOT / "public/assets/app.js").write_text('import { localAuthClient } from "./local-auth.js";\n' + original, encoding="utf8", newline="\n")
    report = {"source": BASE, "downloaded_at": datetime.now(timezone.utc).isoformat(), "files": sorted(manifest, key=lambda x: x["file"])}
    (ROOT / "docs/download-manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8", newline="\n")
    print(f"Arquivos baixados: {len(manifest)}; fontes: {len(families)}; categorias: {len(site['categories'])}; produtos: {len(site['products'])}.")


if __name__ == "__main__":
    main()
