"""
Scraper de precios de combustible desde Facilito (OSINERGMIN).
Recorre todos los departamentos de Perú en paralelo.
Guarda cache diario para no repetir consultas.
"""
import asyncio
import re
import json
import os
import logging
from datetime import date
from playwright.async_api import async_playwright

LOG = logging.getLogger("facilito")

FACILITO_URL = "https://www.facilito.gob.pe/facilito/pages/facilito/buscadorEESS.jsp"
CACHE_DIR = os.path.join(os.path.dirname(__file__), "facilito_cache")

DEPARTAMENTOS = {
    "AMAZONAS": "10000", "ANCASH": "20000", "APURIMAC": "30000",
    "AREQUIPA": "40000", "AYACUCHO": "50000", "CAJAMARCA": "60000",
    "PROV. CONST. DEL CALLAO": "70000", "CUSCO": "80000",
    "HUANCAVELICA": "90000", "HUANUCO": "100000", "ICA": "110000",
    "JUNIN": "120000", "LA LIBERTAD": "130000", "LAMBAYEQUE": "140000",
    "LIMA": "150000", "LORETO": "160000", "MADRE DE DIOS": "170000",
    "MOQUEGUA": "180000", "PASCO": "190000", "PIURA": "200000",
    "PUNO": "210000", "SAN MARTIN": "220000", "TACNA": "230000",
    "TUMBES": "240000", "UCAYALI": "250000",
}

PRODUCTOS = {
    "GASOHOL PREMIUM": "127",
    "GASOHOL REGULAR": "126",
    "DB5 S-50 UV": "40",
}

_progress = {}


def get_progress(session_id: str):
    return _progress.get(session_id, {"step": "Sin iniciar", "pct": 0, "done": False})


def _clean_html(text: str) -> str:
    text = re.sub(r'<[^>]+>', '', text).strip()
    text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    return text


def _cache_path(departamento_code: str):
    os.makedirs(CACHE_DIR, exist_ok=True)
    return os.path.join(CACHE_DIR, f"{departamento_code}_{date.today().isoformat()}.json")


def _load_cache(departamento_code: str):
    path = _cache_path(departamento_code)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def _save_cache(departamento_code: str, data: list):
    path = _cache_path(departamento_code)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


async def _wait_recaptcha(page):
    for _ in range(15):
        token = await page.evaluate('document.getElementById("g-recaptcha-response")?.value || ""')
        if token:
            return True
        await asyncio.sleep(2)
    return False


async def _extract_datatable(page):
    return await page.evaluate("""
        () => {
            try {
                const dt = $('#tblPreciosAutomotor').DataTable();
                return dt.rows().data().toArray().map(row => ({
                    distrito: row[0] || '',
                    establecimiento: row[1] || '',
                    direccion: row[2] || '',
                    telefono: row[3] || '',
                    precio: row[4] || '',
                }));
            } catch(e) { return []; }
        }
    """)


async def scrape_one_departamento(departamento_name: str, departamento_code: str, progress_cb=None):
    """Scrape all provincias × productos for one departamento."""
    # Check cache first
    cached = _load_cache(departamento_code)
    if cached is not None:
        if progress_cb:
            progress_cb(f"{departamento_name}: cache del dia ({len(cached)} registros)")
        return cached

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
        )
        page = await context.new_page()

        try:
            await page.goto(FACILITO_URL, timeout=60000)
            await asyncio.sleep(3)

            async with page.expect_navigation(wait_until="networkidle", timeout=60000):
                await page.evaluate(f"makeAction({departamento_code})")
            await asyncio.sleep(3)

            # Read provincias
            provincias = await page.evaluate("""
                () => {
                    const sel = document.querySelector('select[name="provincia"]');
                    if (!sel) return [];
                    return Array.from(sel.options)
                        .map(o => ({value: o.value, text: o.text.trim()}))
                        .filter(o => o.value && o.value !== '9999999' && o.value !== '');
                }
            """)

            all_results = []

            for prov in provincias:
                await _wait_recaptcha(page)
                async with page.expect_navigation(wait_until="networkidle", timeout=60000):
                    await page.evaluate(f"""
                        () => {{
                            document.querySelector('select[name="provincia"]').value = "{prov['value']}";
                            cambiarProvincia();
                        }}
                    """)
                await asyncio.sleep(2)

                for prod_name, prod_code in PRODUCTOS.items():
                    if progress_cb:
                        progress_cb(f"{departamento_name} — {prov['text']} — {prod_name}")

                    try:
                        await _wait_recaptcha(page)
                        async with page.expect_navigation(wait_until="networkidle", timeout=60000):
                            await page.evaluate(f"""
                                () => {{
                                    document.querySelector('select[name="producto"]').value = "{prod_code}";
                                    cambiarProducto();
                                }}
                            """)
                        await asyncio.sleep(2)

                        raw_rows = await _extract_datatable(page)

                        for r in raw_rows:
                            all_results.append({
                                "departamento": departamento_name,
                                "provincia": prov["text"],
                                "distrito": _clean_html(r["distrito"]),
                                "establecimiento": _clean_html(r["establecimiento"]),
                                "direccion": _clean_html(r["direccion"]),
                                "telefono": _clean_html(r["telefono"]),
                                "precio": _clean_html(r["precio"]),
                                "producto": prod_name,
                            })

                    except Exception as e:
                        LOG.warning(f"Error {departamento_name}/{prov['text']}/{prod_name}: {e}")

            _save_cache(departamento_code, all_results)
            await browser.close()
            return all_results

        except Exception as e:
            await browser.close()
            raise


async def scrape_peru(session_id: str = "default", departamentos: list = None):
    """
    Scrape all of Peru (or specific departamentos) in parallel.
    Opens up to 3 browsers simultaneously.
    """
    if departamentos is None:
        deps = list(DEPARTAMENTOS.items())
    else:
        deps = [(k, v) for k, v in DEPARTAMENTOS.items() if v in departamentos or k in departamentos]

    total = len(deps)
    done = 0
    all_data = []
    lock = asyncio.Lock()

    _progress[session_id] = {
        "step": f"Iniciando scraping de {total} departamentos...",
        "pct": 0, "done": False, "departamentos_done": 0, "departamentos_total": total,
    }

    sem = asyncio.Semaphore(3)  # 3 browsers in parallel (safe for 16GB RAM)

    async def process_dep(name, code):
        nonlocal done
        async with sem:
            def on_progress(msg):
                _progress[session_id]["step"] = msg

            try:
                result = await scrape_one_departamento(name, code, progress_cb=on_progress)
                async with lock:
                    all_data.extend(result)
                    done += 1
                    _progress[session_id]["pct"] = int(95 * done / total)
                    _progress[session_id]["departamentos_done"] = done
                    _progress[session_id]["step"] = f"{name} listo ({len(result)} registros). {done}/{total} departamentos."
                    LOG.info(f"{name}: {len(result)} registros. ({done}/{total})")
            except Exception as e:
                async with lock:
                    done += 1
                    _progress[session_id]["departamentos_done"] = done
                    LOG.error(f"Error {name}: {e}")

    tasks = [process_dep(name, code) for name, code in deps]
    await asyncio.gather(*tasks)

    _progress[session_id] = {
        "step": f"Listo. {len(all_data)} registros de {total} departamentos.",
        "pct": 100, "done": True,
        "departamentos_done": total, "departamentos_total": total,
    }

    return all_data


async def scrape_departamento(departamento_code: str, session_id: str = "default"):
    """Single departamento scrape (backward compat)."""
    name = next((k for k, v in DEPARTAMENTOS.items() if v == departamento_code), departamento_code)

    def on_progress(msg):
        _progress[session_id]["step"] = msg

    _progress[session_id] = {"step": f"Scraping {name}...", "pct": 5, "done": False}
    result = await scrape_one_departamento(name, departamento_code, progress_cb=on_progress)
    _progress[session_id] = {"step": "Listo", "pct": 100, "done": True}
    return result
