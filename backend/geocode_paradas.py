"""
Script para geocodificar todas las paradas del Excel PARADEROS.xlsx
usando Nominatim. Guarda resultado en paradas_coords.json.
Ejecutar una sola vez: python geocode_paradas.py
"""
import pandas as pd
import requests
import json
import time
import os

ZONAS_COORDS = {
    "CASA GRANDE": {"lat": -7.7446, "lng": -79.1881},
    "CASAGRANDE": {"lat": -7.7446, "lng": -79.1881},
    "PORVENIR": {"lat": -8.08682061362065, "lng": -79.00359985119874},
    "EL PORVENIR": {"lat": -8.08682061362065, "lng": -79.00359985119874},
    "VERDUN": {"lat": -7.3400, "lng": -79.4650},
    "CHICLAYO": {"lat": -6.7714, "lng": -79.8409},
    "MACABI": {"lat": -7.716899604256314, "lng": -79.36905757878583},
    "MACABI BAJO": {"lat": -7.716899604256314, "lng": -79.36905757878583},
    "MACABI ALTO": {"lat": -7.716899604256314, "lng": -79.36905757878583},
    "PACASMAYO": {"lat": -7.39689879739237, "lng": -79.56631840372023},
    "POMALCA": {"lat": -6.7656, "lng": -79.7731},
    "SANTIAGO DE CAO": {"lat": -7.956110136413037, "lng": -79.23975807179532},
    "CHICAMA": {"lat": -7.847991921019035, "lng": -79.14029365523025},
    "JEQUETEPEQUE": {"lat": -7.337929292586088, "lng": -79.56393247353924},
    "GUADALUPE": {"lat": -7.2432138601718945, "lng": -79.47059163595777},
    "CHEQUEN": {"lat": -7.3007892, "lng": -79.481713},
    "TRUJILLO": {"lat": -8.1119306, "lng": -79.0263645},
    "SAUSAL": {"lat": -7.7320975, "lng": -79.0051685},
    "CIUDAD DE DIOS": {"lat": -7.299663633555787, "lng": -79.48137443840217},
    "CHOCOPE": {"lat": -7.7911198, "lng": -79.2197376},
    "PAIJAN": {"lat": -7.7341853, "lng": -79.3028999},
    "ROMA": {"lat": -7.7624797, "lng": -79.1463868},
    "CARTAVIO": {"lat": -7.8889329, "lng": -79.2211476},
    "ALTO TRUJILLO": {"lat": -8.0592756, "lng": -79.0123571},
    "LA ESPERANZA": {"lat": -8.0652615, "lng": -79.0615355},
    "EL MILAGRO": {"lat": -8.0230466, "lng": -79.0673302},
    "PUERTO MALABRIGO": {"lat": -7.7001724, "lng": -79.4338188},
    "SAN PEDRO DE LLOC": {"lat": -7.4250154, "lng": -79.5033042},
    "CHEPEN": {"lat": -7.2271893, "lng": -79.4288257},
    "SEMAN": {"lat": -7.7850, "lng": -79.2150},
    "SINTUCO": {"lat": -7.8116979, "lng": -79.1995111},
    "MAZANCA": {"lat": -7.3776741, "lng": -79.4795286},
    "PACANGUILLA": {"lat": -7.1569031, "lng": -79.4450726},
    "PAMPAS DE JAGUEY": {"lat": -7.6609907, "lng": -78.9488785},
    "CHIQUITOY": {"lat": -7.9261793, "lng": -79.2098667},
    "SALAVERRY": {"lat": -8.2141205, "lng": -78.9768999},
    "VIRU": {"lat": -8.4165648, "lng": -78.7518716},
    "ALTO MOCHE": {"lat": -8.1835285, "lng": -78.9896218},
    "FACALA": {"lat": -7.7219998, "lng": -79.1583807},
    "MANUEL AREVALO": {"lat": -8.0672429, "lng": -79.0630932},
    "LIMONCARRO": {"lat": -7.3037166, "lng": -79.4183427},
}


def geocode(query):
    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": query, "format": "json", "limit": 1, "countrycodes": "pe"},
            headers={"User-Agent": "CosechaOptimizer/1.0 (geocode script)"},
            timeout=10,
        )
        if r.status_code == 200:
            data = r.json()
            if data:
                return {"lat": float(data[0]["lat"]), "lng": float(data[0]["lon"])}
    except Exception as e:
        print(f"  Error: {e}")
    return None


def main():
    xlsx_path = os.path.join(os.path.dirname(__file__), "PARADEROS.xlsx")
    df = pd.read_excel(xlsx_path)
    df.columns = [c.strip().upper() for c in df.columns]

    result = {}
    total = len(df)

    for i, row in df.iterrows():
        distrito = str(row["DISTRITO"]).strip()
        paradero = str(row["PARADERO"]).strip() if pd.notna(row["PARADERO"]) else ""

        if not paradero:
            paradero = "PLAZA DE ARMAS"

        key = f"{distrito}|{paradero}"

        # Try geocoding with context
        queries = [
            f"{paradero}, {distrito}, La Libertad, Peru",
            f"{paradero}, {distrito}, Peru",
        ]

        coords = None
        for q in queries:
            coords = geocode(q)
            if coords:
                break
            time.sleep(1.2)

        if not coords:
            # Fallback to district coords
            dc = ZONAS_COORDS.get(distrito.upper())
            if dc:
                coords = dict(dc)
                print(f"  [{i+1}/{total}] {key} -> FALLBACK to district coords")
            else:
                print(f"  [{i+1}/{total}] {key} -> NO COORDS")
                continue
        else:
            print(f"  [{i+1}/{total}] {key} -> {coords['lat']}, {coords['lng']}")

        if distrito not in result:
            result[distrito] = []
        result[distrito].append({
            "nombre": paradero,
            "lat": coords["lat"],
            "lng": coords["lng"],
        })

        time.sleep(1.2)

    # Add zones without stops (Plaza de Armas fallback)
    zonas_path = os.path.join(os.path.dirname(__file__), "ZONAS_PROCEDENCIA.xlsx")
    if os.path.exists(zonas_path):
        zdf = pd.read_excel(zonas_path)
        all_zonas = set(zdf["NOMBRE"].str.strip().str.upper())
        existing = set(k.upper() for k in result.keys())

        for zona in sorted(all_zonas - existing):
            dc = ZONAS_COORDS.get(zona)
            if dc:
                result[zona] = [{"nombre": "PLAZA DE ARMAS", "lat": dc["lat"], "lng": dc["lng"]}]
                print(f"  [extra] {zona} -> Plaza de Armas (district coords)")

    out_path = os.path.join(os.path.dirname(__file__), "paradas_coords.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\nDone! {len(result)} districts, saved to {out_path}")


if __name__ == "__main__":
    main()
