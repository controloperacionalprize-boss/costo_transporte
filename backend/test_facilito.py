import asyncio
from playwright.async_api import async_playwright

async def wait_recaptcha(page):
    for _ in range(15):
        token = await page.evaluate('document.getElementById("g-recaptcha-response")?.value || ""')
        if token:
            return True
        await asyncio.sleep(2)
    return False

async def test():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
        )
        page = await context.new_page()

        print("1. Cargando pagina...")
        await page.goto("https://www.facilito.gob.pe/facilito/pages/facilito/buscadorEESS.jsp", timeout=60000)
        await asyncio.sleep(3)

        print("2. Click La Libertad...")
        await page.evaluate("makeAction(130000)")
        await page.wait_for_load_state("networkidle")
        await asyncio.sleep(3)

        print("3. Provincia TRUJILLO...")
        await wait_recaptcha(page)
        await page.evaluate("""
            () => {
                document.querySelector('select[name="provincia"]').value = "130100";
                cambiarProvincia();
            }
        """)
        await page.wait_for_load_state("networkidle")
        await asyncio.sleep(3)

        print("4. Producto GASOHOL PREMIUM...")
        await wait_recaptcha(page)
        await page.evaluate("""
            () => {
                document.querySelector('select[name="producto"]').value = "127";
                cambiarProducto();
            }
        """)
        await page.wait_for_load_state("networkidle")
        await asyncio.sleep(3)

        # Extract ALL data via DataTable API
        print("5. Extrayendo datos via DataTable API...")
        rows = await page.evaluate("""
            () => {
                const dt = $('#tblPreciosAutomotor').DataTable();
                const data = dt.rows().data().toArray();
                return data.map(row => ({
                    distrito: row[0] || '',
                    establecimiento: row[1] || '',
                    direccion: row[2] || '',
                    telefono: row[3] || '',
                    precio: row[4] || '',
                }));
            }
        """)
        print(f"\n   Resultados: {len(rows)}")
        for r in rows[:10]:
            print(f"     {r['distrito']} | {r['establecimiento']} | S/{r['precio']}")
        if len(rows) > 10:
            print(f"     ... y {len(rows)-10} mas")

        await browser.close()

asyncio.run(test())
