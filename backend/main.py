from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import io
import json
import asyncio
import os
import math
import time
import requests as http_requests
from dotenv import load_dotenv
import psycopg2

load_dotenv()


class ProcessRequest(BaseModel):
    session_id: str

class RebalanceoRequest(BaseModel):
    session_id: str
    umbral: int = 70

app = FastAPI(title="Optimizacion Transporte Cosecha")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory session store
# ---------------------------------------------------------------------------
sessions: dict = {}

def get_session(session_id: str) -> dict:
    if session_id not in sessions:
        sessions[session_id] = {}
    return sessions[session_id]

import threading
import math

def _normalizar_ruta(ruta: str) -> str:
    """Normalize RUTA field: clean origin => destination format."""
    if not ruta or ruta in ("nan", "None", ""):
        return ""
    ruta = ruta.strip()
    if "=>" not in ruta:
        return ruta.upper().strip()

    origen, destino = ruta.split("=>", 1)
    origen = _normalizar_lugar(origen.strip())
    destino = _normalizar_destino(destino.strip())
    return f"{origen} => {destino}"


_DESTINO_MAP = {
    "AQU ANQA": "AQUANQA",
    "AQUANQA": "AQUANQA",
    "PLANTA": "AQUANQA",
    "SANTA TERESA - AQ2": "SANTA TERESA",
    "SANTA TERESA": "SANTA TERESA",
    "VIVADIS - AQ2": "VIVADIS",
    "VIVADIS": "VIVADIS",
    "AYLLU ALLPA": "AYLLU ALLPA",
    "AYLLUALLPA": "AYLLU ALLPA",
}

_ORIGEN_MAP = {
    "PUERTO MALABRIGO.": "PUERTO MALABRIGO",
    "PUERTO MALABRIGO": "PUERTO MALABRIGO",
    "PAIJAN": "PAIJAN",
    "PAIJÁN": "PAIJAN",
    "TERMINAL PAIJÁN": "PAIJAN",
    "TERMINAL PAIJAN": "PAIJAN",
    "CHEQUÉN": "CHEQUEN",
    "CHEPÉN": "CHEPEN",
    "MACABÍ": "MACABI",
    "FACALÁ": "FACALA",
    "SEMÁN": "SEMAN",
    "TOLÓN": "TOLON",
    "CASAGRANDE": "CASA GRANDE",
    "CASA GRANDE": "CASA GRANDE",
}


def _normalizar_destino(destino: str) -> str:
    key = destino.upper().strip().rstrip(".")
    return _DESTINO_MAP.get(key, key)


def _normalizar_lugar(lugar: str) -> str:
    key = lugar.upper().strip().rstrip(".")
    return _ORIGEN_MAP.get(key, key)


def _safe(v, default=""):
    if v is None:
        return default
    try:
        if math.isnan(v) or math.isinf(v):
            return default
    except (TypeError, ValueError):
        pass
    return v

# ---------------------------------------------------------------------------
# Processing helpers
# ---------------------------------------------------------------------------

def procesar_viajes(file_bytes: bytes) -> pd.DataFrame:
    df_raw = pd.read_excel(io.BytesIO(file_bytes), sheet_name="DATA", header=None)
    header_idx = df_raw[df_raw.iloc[:, 0] == "CORRELATIVO"].index
    if len(header_idx) == 0:
        header_idx = df_raw[df_raw.iloc[:, 1] == "CORRELATIVO"].index
    skip = header_idx[0] if len(header_idx) > 0 else 1
    df = pd.read_excel(io.BytesIO(file_bytes), sheet_name="DATA", header=skip)
    df.columns = df.columns.str.strip()
    df["NRO. PAS. IDA"] = pd.to_numeric(df["NRO. PAS. IDA"], errors="coerce").fillna(0).astype(int)
    df_ida = df[
        (df["NRO. PAS. IDA"] != 0)
        & (df["CECO"].astype(str).str.contains("COSECHA", case=False, na=False))
    ].copy()
    df_ida["BUS"] = df_ida["BUS"].astype(str).str.strip().str.upper()
    df_ida["CAPACIDAD"] = pd.to_numeric(df_ida["CAPACIDAD"], errors="coerce").fillna(0).astype(int)
    df_ida["RUTA"] = df_ida["RUTA"].astype(str).str.strip().apply(_normalizar_ruta)
    viajes_placa = (
        df_ida.groupby("BUS")
        .agg(
            CAPACIDAD=("CAPACIDAD", "first"),
            PAS_IDA_VIAJES=("NRO. PAS. IDA", "sum"),
            ZONA_PROCEDENCIA=("ZONA PROCEDENCIA", "first"),
            CECO=("CECO", "first"),
            T_BUS=("T.BUS", "first"),
            RUTA=("RUTA", "first"),
            TARIFA=("TARIFA", "sum"),
        )
        .reset_index()
    )
    return viajes_placa


def procesar_asistencia(file_bytes: bytes) -> pd.DataFrame:
    xls = pd.ExcelFile(io.BytesIO(file_bytes))
    sheet = "DATA" if "DATA" in xls.sheet_names else xls.sheet_names[0]
    df_raw = pd.read_excel(xls, sheet_name=sheet, header=None, nrows=10)
    skip = 0
    for r in range(min(10, len(df_raw))):
        row_vals = df_raw.iloc[r].astype(str).str.strip().str.upper().tolist()
        if "TIPO" in row_vals:
            skip = r
            break
    df = pd.read_excel(xls, sheet_name=sheet, header=skip)
    df.columns = df.columns.str.strip()
    tipo_col = [c for c in df.columns if "TIPO" in c.upper()]
    if not tipo_col:
        raise ValueError(f"No se encontro columna TIPO. Columnas: {list(df.columns)[:10]}")
    df_entrada = df[df[tipo_col[0]].astype(str).str.upper() == "ENTRADA"].copy()
    df_entrada["PLACA"] = df_entrada["PLACA"].astype(str).str.strip().str.upper()
    df_entrada["DNI PASA."] = df_entrada["DNI PASA."].astype(str).str.strip()
    df_entrada["KILOS"] = pd.to_numeric(df_entrada["KILOS"], errors="coerce").fillna(0)
    personas = (
        df_entrada.sort_values("HORA")
        .drop_duplicates(subset=["DNI PASA."], keep="first")[["PLACA", "DNI PASA.", "PASAJERO", "KILOS"]]
        .copy()
    )
    return personas


def extraer_fecha_reporte(file_bytes: bytes):
    """Extract the report date from the asistencia file."""
    try:
        xls = pd.ExcelFile(io.BytesIO(file_bytes))
        sheet = "DATA" if "DATA" in xls.sheet_names else xls.sheet_names[0]
        df_raw = pd.read_excel(xls, sheet_name=sheet, header=None, nrows=10)
        sk = 0
        for rr in range(min(10, len(df_raw))):
            if "FECHA" in df_raw.iloc[rr].astype(str).str.upper().tolist():
                sk = rr
                break
        df_fecha = pd.read_excel(xls, sheet_name=sheet, header=sk, usecols=["FECHA"])
        df_fecha.columns = df_fecha.columns.str.strip()
        fecha = pd.to_datetime(df_fecha["FECHA"], dayfirst=True, errors="coerce").dropna().iloc[0]
        return fecha
    except Exception:
        return None


def _df_to_records(df: pd.DataFrame) -> list:
    """Convert a DataFrame to a list of dicts, handling NaN/NaT for JSON serialization."""
    return json.loads(df.to_json(orient="records", date_format="iso", default_handler=str))

# ---------------------------------------------------------------------------
# DATABASE (PostgreSQL) endpoints
# ---------------------------------------------------------------------------

def _ensure_session_data(sess: dict):
    """Re-load and process data from DB if session is empty (Vercel serverless fix)."""
    if sess.get("cruce") is not None and sess.get("personas_enriched") is not None:
        return
    conn = _get_db_conn()
    cur = conn.cursor()
    cur.execute('SELECT MAX("FECHA") FROM rpt_controlbus_asistencia')
    row = cur.fetchone()
    if not row or not row[0]:
        conn.close()
        return
    fecha = str(row[0])

    _load_db_data_sync(sess, conn, fecha, "", "", "")
    conn.close()

    if sess.get("viajes_placa") is not None and sess.get("personas") is not None:
        _run_process_sync(sess)


def _load_db_data_sync(sess, conn, fecha, fecha_desde, fecha_hasta, empresa):
    """Synchronous DB load for serverless (no threading)."""
    cur = conn.cursor()

    def _find_col(cols, *keywords):
        for c in cols:
            for kw in keywords:
                if kw.lower() in c.lower():
                    return c
        return None

    # Jarras
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'rpt_formato_jarra_aq1' ORDER BY ordinal_position")
    jarra_cols = [r[0] for r in cur.fetchall()]
    col_dni = _find_col(jarra_cols, "dni", "documento", "trabajador_dni")
    col_nombre = _find_col(jarra_cols, "trabajador", "nombre")
    col_jarras = _find_col(jarra_cols, "jarras", "total")
    col_fecha = _find_col(jarra_cols, "fecha")
    col_semana = _find_col(jarra_cols, "semana")
    if col_dni and col_jarras:
        select_cols = ", ".join(f'"{c}"' for c in [col_dni, col_nombre, col_jarras, col_fecha, col_semana] if c)
        fecha_filter = f'WHERE "{col_fecha}" >= CURRENT_DATE - INTERVAL \'14 days\'' if col_fecha else ""
        df_jarra = pd.read_sql(f"SELECT {select_cols} FROM (SELECT {select_cols} FROM rpt_formato_jarra_aq1 UNION ALL SELECT {select_cols} FROM rpt_formato_jarra_aq2) j {fecha_filter}", conn)
        rename_j = {col_dni: "Dni_Trabajador", col_jarras: "Total Jarras", col_semana: "SEMANA"}
        if col_nombre: rename_j[col_nombre] = "Trabajador"
        if col_fecha: rename_j[col_fecha] = "FECHA"
        df_jarra.rename(columns=rename_j, inplace=True)
        sess["df_jarra"] = df_jarra

    # Horas/Actividad
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'rpt_formato_horas_aq1' ORDER BY ordinal_position")
    horas_cols = [r[0] for r in cur.fetchall()]
    col_h_dni = _find_col(horas_cols, "documento", "dni")
    col_h_act = next((c for c in horas_cols if c.strip().lower() == "actividad"), None) or _find_col(horas_cols, "actividad", "labor")
    col_h_fecha = _find_col(horas_cols, "fecha")
    col_h_nombre = next((c for c in horas_cols if c.strip().lower() == "trabajador"), None) or _find_col(horas_cols, "nombre")
    if col_h_dni and col_h_act:
        h_select = ", ".join(f'"{c}"' for c in [col_h_dni, col_h_act, col_h_fecha, col_h_nombre] if c)
        where_h = f'WHERE "{col_h_fecha}" >= CURRENT_DATE - INTERVAL \'14 days\'' if col_h_fecha else ""
        df_actividad = pd.read_sql(f"SELECT {h_select} FROM (SELECT {h_select} FROM rpt_formato_horas_aq1 UNION ALL SELECT {h_select} FROM rpt_formato_horas_aq2) h {where_h}", conn)
        rename_h = {col_h_dni: "Documento", col_h_act: "ACTIVIDAD"}
        if col_h_fecha: rename_h[col_h_fecha] = "FECHA"
        if col_h_nombre: rename_h[col_h_nombre] = "TRABAJADOR"
        df_actividad.rename(columns=rename_h, inplace=True)
        sess["df_actividad"] = df_actividad

    # Asistencia
    fecha_where = f""""FECHA" = '{fecha}'"""
    empresa_where = f""" AND "EMPRESA" = '{empresa}'""" if empresa else ""
    df_asist = pd.read_sql(f'SELECT "PLACA", "DNI PASA", "PASAJERO", "KILOS", "HORA", "TIPO", "FECHA" FROM rpt_controlbus_asistencia WHERE {fecha_where}{empresa_where}', conn)
    df_asist.columns = ["PLACA", "DNI PASA.", "PASAJERO", "KILOS", "HORA", "TIPO", "FECHA"]
    df_entrada = df_asist[df_asist["TIPO"].astype(str).str.upper() == "ENTRADA"].copy()
    df_entrada["PLACA"] = df_entrada["PLACA"].astype(str).str.strip().str.upper()
    df_entrada["DNI PASA."] = df_entrada["DNI PASA."].astype(str).str.strip()
    df_entrada["KILOS"] = pd.to_numeric(df_entrada["KILOS"], errors="coerce").fillna(0)
    personas_db = df_entrada.sort_values("HORA")[["PLACA", "DNI PASA.", "PASAJERO", "KILOS", "FECHA"]].copy()
    try:
        dni_list = personas_db["DNI PASA."].dropna().unique().tolist()
        if len(dni_list) > 0:
            placeholders = ",".join([f"'{d}'" for d in dni_list])
            df_func = pd.read_sql(f"SELECT payload->>'DNI' AS dni, payload->>'COLABORADOR' AS colaborador, payload->>'CARGO' AS cargo, payload->>'ÁREA' AS area FROM qbiz_funcionarios_raw WHERE payload->>'DNI' IN ({placeholders})", conn)
            df_func["dni"] = df_func["dni"].astype(str).str.strip()
            df_func = df_func.drop_duplicates(subset=["dni"], keep="first")
            personas_db = personas_db.merge(df_func, left_on="DNI PASA.", right_on="dni", how="left")
            personas_db["PASAJERO"] = personas_db["colaborador"].fillna(personas_db["PASAJERO"])
            personas_db.drop(columns=["dni", "colaborador"], inplace=True, errors="ignore")
    except Exception:
        pass
    sess["personas"] = personas_db
    sess["asistencia_from_db"] = True

    # Viajes
    viajes_emp_where = f""" AND "EMPRESA" = '{empresa}'""" if empresa else ""
    df_viajes_raw = pd.read_sql(f"""SELECT "BUS","CAPACIDAD","PORCENTAJE OCUP","NRO. PAS. IDA","ZONA PROCEDENCIA","CECO","T.BUS","RUTA","TARIFA","FECHA","EMPRESA","PROVEEDOR" FROM (SELECT "BUS","CAPACIDAD","PORCENTAJE OCUP","NRO. PAS. IDA","ZONA PROCEDENCIA","CECO","T.BUS","RUTA","TARIFA","FECHA","EMPRESA","PROVEEDOR" FROM rpt_controlbus_viajes_aq1 UNION ALL SELECT "BUS","CAPACIDAD","PORCENTAJE OCUP","NRO. PAS. IDA","ZONA PROCEDENCIA","CECO","T.BUS","RUTA","TARIFA","FECHA","EMPRESA","PROVEEDOR" FROM rpt_controlbus_viajes_aq2) v WHERE {fecha_where}{viajes_emp_where}""", conn)
    df_viajes_raw["NRO. PAS. IDA"] = pd.to_numeric(df_viajes_raw["NRO. PAS. IDA"], errors="coerce").fillna(0).astype(int)
    df_viajes_raw = df_viajes_raw[(df_viajes_raw["NRO. PAS. IDA"] != 0) & (df_viajes_raw["CECO"].astype(str).str.contains("COSECHA", case=False, na=False))].copy()
    df_viajes_raw["BUS"] = df_viajes_raw["BUS"].astype(str).str.strip().str.upper()
    df_viajes_raw["CAPACIDAD"] = pd.to_numeric(df_viajes_raw["CAPACIDAD"], errors="coerce").fillna(0).astype(int)
    df_viajes_raw["RUTA"] = df_viajes_raw["RUTA"].fillna("").astype(str).str.strip().replace({"nan": "", "None": ""})
    df_viajes_raw["RUTA"] = df_viajes_raw["RUTA"].apply(_normalizar_ruta)
    viajes_placa = df_viajes_raw.groupby("BUS").agg(CAPACIDAD=("CAPACIDAD", "first"), PAS_IDA_VIAJES=("NRO. PAS. IDA", "sum"), ZONA_PROCEDENCIA=("ZONA PROCEDENCIA", "first"), CECO=("CECO", "first"), T_BUS=("T.BUS", "first"), RUTA=("RUTA", "first"), TARIFA=("TARIFA", "sum"), EMPRESA=("EMPRESA", "first"), PROVEEDOR=("PROVEEDOR", "first"), PORCENTAJE_OCUP=("PORCENTAJE OCUP", "first")).reset_index()
    _DESTINOS_AQ2 = {"VIVADIS", "SANTA TERESA", "AYLLU ALLPA"}
    def _planta(ruta):
        if "=>" in str(ruta):
            d = str(ruta).split("=>")[1].strip().upper()
            if d in _DESTINOS_AQ2: return "AQ2"
        return "AQ1"
    viajes_placa["PLANTA"] = viajes_placa["RUTA"].apply(_planta)
    sess["viajes_placa"] = viajes_placa
    sess["viajes_from_db"] = True


def _run_process_sync(sess):
    """Run the cruce/process logic synchronously."""
    viajes_placa = sess["viajes_placa"]
    personas = sess["personas"].copy()

    df_jarra = sess.get("df_jarra")
    if df_jarra is not None:
        jarra_cols_available = [c for c in ["Dni_Trabajador", "Total Jarras", "FECHA"] if c in df_jarra.columns]
        df_rend = df_jarra[jarra_cols_available].copy()
        df_rend.columns = ["DNI_JARRA", "JARRAS"] + (["FECHA_JARRA"] if "FECHA" in jarra_cols_available else [])
        df_rend["DNI_JARRA"] = df_rend["DNI_JARRA"].astype(str).str.strip()
        df_rend["JARRAS"] = pd.to_numeric(df_rend["JARRAS"], errors="coerce").fillna(0)
        if "FECHA_JARRA" in df_rend.columns:
            jarras_dia = df_rend.groupby(["DNI_JARRA", "FECHA_JARRA"]).agg(JARRAS_DIA=("JARRAS", "sum")).reset_index()
            jarras_prom = jarras_dia.groupby("DNI_JARRA").agg(PROM_JARRAS_SEM=("JARRAS_DIA", "mean")).reset_index()
        else:
            jarras_prom = df_rend.groupby("DNI_JARRA").agg(PROM_JARRAS_SEM=("JARRAS", "mean")).reset_index()
        jarras_prom["PROM_JARRAS_SEM"] = jarras_prom["PROM_JARRAS_SEM"].round(1)
        personas = personas.merge(jarras_prom, left_on="DNI PASA.", right_on="DNI_JARRA", how="left")
        personas["PROM_JARRAS_SEM"] = personas["PROM_JARRAS_SEM"].fillna(0)
        personas.drop(columns=["DNI_JARRA"], inplace=True, errors="ignore")

    df_actividad = sess.get("df_actividad")
    if df_actividad is not None:
        df_act = df_actividad.copy()
        df_act.columns = df_act.columns.str.strip()
        act_cols = df_act.columns.tolist()
        dni_col_act = next((c for c in act_cols if "DOCUMENTO" in c.upper() or "DNI" in c.upper()), None)
        act_col = next((c for c in act_cols if "ACTIVIDAD" in c.upper() or "LABOR" in c.upper()), None)
        if dni_col_act and act_col:
            df_act[dni_col_act] = df_act[dni_col_act].astype(str).str.strip().str.replace(r'\.0$', '', regex=True)
            personas["DNI PASA."] = personas["DNI PASA."].astype(str).str.strip().str.replace(r'\.0$', '', regex=True)
            act_moda = df_act.groupby(dni_col_act)[act_col].agg(lambda x: x.value_counts().index[0] if len(x.value_counts()) > 0 else "").reset_index()
            act_moda.columns = ["DNI_ACT", "ACTIVIDAD"]
            personas = personas.merge(act_moda, left_on="DNI PASA.", right_on="DNI_ACT", how="left")
            personas["ACTIVIDAD"] = personas["ACTIVIDAD"].fillna("")
            personas.drop(columns=["DNI_ACT"], inplace=True, errors="ignore")

    asist_placa = personas.groupby("PLACA").agg(PAS_REAL=("DNI PASA.", "count")).reset_index()
    cruce = viajes_placa.merge(asist_placa, left_on="BUS", right_on="PLACA", how="left")
    cruce["PAS_REAL"] = cruce["PAS_REAL"].fillna(0).astype(int)
    cruce["ASIENTOS_VACIOS"] = cruce["CAPACIDAD"] - cruce["PAS_REAL"]
    cruce["% OCUP. REAL"] = cruce.apply(lambda r: round(r["PAS_REAL"] / r["CAPACIDAD"] * 100, 1) if r["CAPACIDAD"] > 0 else 0, axis=1)
    cruce["COSTO_PASAJERO"] = cruce.apply(lambda r: round(r["TARIFA"] / r["PAS_REAL"], 2) if r["PAS_REAL"] > 0 else 0, axis=1)
    cruce["PERDIDA"] = cruce.apply(lambda r: round((r["TARIFA"] / r["CAPACIDAD"]) * r["ASIENTOS_VACIOS"], 2) if r["CAPACIDAD"] > 0 else 0, axis=1)
    cruce = cruce.fillna({"RUTA": "", "ZONA_PROCEDENCIA": "", "CECO": "", "T_BUS": "", "PROVEEDOR": "", "PORCENTAJE_OCUP": 0})
    cruce = cruce.sort_values("ASIENTOS_VACIOS", ascending=False)

    sess["cruce"] = cruce
    sess["personas_enriched"] = personas


def _get_db_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT", "5432"),
        dbname=os.getenv("DB_NAME", "db_control_operacional"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
    )


class DBLoadRequest(BaseModel):
    session_id: str = "default"
    fecha: str = ""
    fecha_desde: str = ""
    fecha_hasta: str = ""
    empresa: str = ""


import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cosecha")

def _load_db_data(session_id: str, fecha: str = "", fecha_desde: str = "", fecha_hasta: str = "", empresa: str = ""):
    logger.info(f"=== DB LOAD START === session={session_id} fecha={fecha} fecha_desde={fecha_desde} fecha_hasta={fecha_hasta} empresa={empresa}")
    sess = get_session(session_id)
    sess["db_progress"] = {"step": "Conectando a base de datos...", "pct": 0, "done": False, "errors": []}

    from datetime import datetime

    try:
        conn = _get_db_conn()
        logger.info("DB connection OK")
        cur = conn.cursor()

        # Descubrir columnas de jarras
        sess["db_progress"] = {"step": "Descubriendo esquema de tablas...", "pct": 10, "done": False, "errors": []}
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'rpt_formato_jarra_aq1' ORDER BY ordinal_position")
        jarra_cols = [r[0] for r in cur.fetchall()]
        sess["db_progress"]["step"] = f"Columnas jarras: {jarra_cols}"
        sess["db_progress"]["pct"] = 15

        # Mapear columnas flexiblemente
        def _find_col(cols, *keywords):
            for c in cols:
                for kw in keywords:
                    if kw.lower() in c.lower():
                        return c
            return None

        col_dni = _find_col(jarra_cols, "dni", "documento", "trabajador_dni")
        col_nombre = _find_col(jarra_cols, "trabajador", "nombre")
        col_jarras = _find_col(jarra_cols, "jarras", "total")
        col_fecha = _find_col(jarra_cols, "fecha")
        col_semana = _find_col(jarra_cols, "semana")

        if not all([col_dni, col_jarras]):
            raise ValueError(f"No se encontraron columnas necesarias en jarras. Columnas: {jarra_cols}")

        sess["db_progress"] = {"step": "Consultando jarras (últimas 2 semanas)...", "pct": 20, "done": False, "errors": []}
        select_cols = ", ".join(f'"{c}"' for c in [col_dni, col_nombre, col_jarras, col_fecha, col_semana] if c)
        fecha_filter = f'WHERE "{col_fecha}" >= CURRENT_DATE - INTERVAL \'14 days\'' if col_fecha else ""
        query_jarras = f"""
            SELECT {select_cols}
            FROM (
                SELECT {select_cols} FROM rpt_formato_jarra_aq1
                UNION ALL
                SELECT {select_cols} FROM rpt_formato_jarra_aq2
            ) j
            {fecha_filter}
        """
        df_jarra = pd.read_sql(query_jarras, conn)
        # Renombrar a nombres esperados
        rename_j = {col_dni: "Dni_Trabajador", col_jarras: "Total Jarras", col_semana: "SEMANA"}
        if col_nombre:
            rename_j[col_nombre] = "Trabajador"
        if col_fecha:
            rename_j[col_fecha] = "FECHA"
        df_jarra.rename(columns=rename_j, inplace=True)
        sess["df_jarra"] = df_jarra
        sess["db_progress"] = {"step": f"Jarras OK ({len(df_jarra):,} filas). Consultando horas...", "pct": 50, "done": False, "errors": []}

        # Descubrir columnas de horas
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'rpt_formato_horas_aq1' ORDER BY ordinal_position")
        horas_cols = [r[0] for r in cur.fetchall()]

        col_h_dni = _find_col(horas_cols, "documento", "dni")
        col_h_act = next((c for c in horas_cols if c.strip().lower() == "actividad"), None) or _find_col(horas_cols, "actividad", "labor")
        col_h_fecha = _find_col(horas_cols, "fecha")
        col_h_nombre = next((c for c in horas_cols if c.strip().lower() == "trabajador"), None) or _find_col(horas_cols, "nombre")

        if not all([col_h_dni, col_h_act]):
            raise ValueError(f"No se encontraron columnas necesarias en horas. Columnas: {horas_cols}")

        h_select = ", ".join(f'"{c}"' for c in [col_h_dni, col_h_act, col_h_fecha, col_h_nombre] if c)
        where_h = f'WHERE "{col_h_fecha}" >= CURRENT_DATE - INTERVAL \'14 days\'' if col_h_fecha else ""
        query_horas = f"""
            SELECT {h_select}
            FROM (
                SELECT {h_select} FROM rpt_formato_horas_aq1
                UNION ALL
                SELECT {h_select} FROM rpt_formato_horas_aq2
            ) h
            {where_h}
        """
        df_actividad = pd.read_sql(query_horas, conn)
        rename_h = {col_h_dni: "Documento", col_h_act: "ACTIVIDAD"}
        if col_h_fecha:
            rename_h[col_h_fecha] = "FECHA"
        if col_h_nombre:
            rename_h[col_h_nombre] = "TRABAJADOR"
        df_actividad.rename(columns=rename_h, inplace=True)
        sess["df_actividad"] = df_actividad
        sess["db_progress"] = {"step": f"Horas OK ({len(df_actividad):,}). Consultando asistencia...", "pct": 70, "done": False, "errors": []}

        # Asistencia (rpt_controlbus_asistencia)
        if fecha_desde and fecha_hasta:
            fecha_where = f""""FECHA" BETWEEN '{fecha_desde}' AND '{fecha_hasta}'"""
        elif fecha:
            fecha_where = f""""FECHA" = '{fecha}'"""
        else:
            cur.execute('SELECT MAX("FECHA") FROM rpt_controlbus_asistencia')
            fecha = str(cur.fetchone()[0])
            fecha_where = f""""FECHA" = '{fecha}'"""
        empresa_where = f""" AND "EMPRESA" = '{empresa}'""" if empresa else ""
        sess["db_progress"]["step"] = f"Consultando asistencia..."
        query_asist = f"""
            SELECT "PLACA", "DNI PASA", "PASAJERO", "KILOS", "HORA", "TIPO", "FECHA"
            FROM rpt_controlbus_asistencia
            WHERE {fecha_where}{empresa_where}
        """
        df_asist = pd.read_sql(query_asist, conn)
        df_asist.columns = ["PLACA", "DNI PASA.", "PASAJERO", "KILOS", "HORA", "TIPO", "FECHA"]
        # Filtrar solo ENTRADA y procesar igual que el Excel
        df_entrada = df_asist[df_asist["TIPO"].astype(str).str.upper() == "ENTRADA"].copy()
        df_entrada["PLACA"] = df_entrada["PLACA"].astype(str).str.strip().str.upper()
        df_entrada["DNI PASA."] = df_entrada["DNI PASA."].astype(str).str.strip()
        df_entrada["KILOS"] = pd.to_numeric(df_entrada["KILOS"], errors="coerce").fillna(0)
        personas_db = (
            df_entrada.sort_values("HORA")[["PLACA", "DNI PASA.", "PASAJERO", "KILOS", "FECHA"]]
            .copy()
        )
        # Enriquecer con datos de qbiz_funcionarios_raw
        try:
            dni_list = personas_db["DNI PASA."].dropna().unique().tolist()
            if len(dni_list) > 0:
                placeholders = ",".join([f"'{d}'" for d in dni_list])
                query_func = f"""
                    SELECT payload->>'DNI' AS dni,
                           payload->>'COLABORADOR' AS colaborador,
                           payload->>'CARGO' AS cargo,
                           payload->>'ÁREA' AS area,
                           payload->>'CENTROCOSTO' AS centrocosto_func,
                           payload->>'EMPRESA' AS empresa_func,
                           payload->>'VIGENCIA' AS vigencia,
                           payload->>'FECHA DE INGRESO' AS fecha_ingreso,
                           payload->>'FECHA DE CESE' AS fecha_cese,
                           payload->>'TIPO TRABAJADOR' AS tipo_trabajador
                    FROM qbiz_funcionarios_raw
                    WHERE payload->>'DNI' IN ({placeholders})
                """
                df_func = pd.read_sql(query_func, conn)
                df_func["dni"] = df_func["dni"].astype(str).str.strip()
                df_func = df_func.drop_duplicates(subset=["dni"], keep="first")
                personas_db = personas_db.merge(df_func, left_on="DNI PASA.", right_on="dni", how="left")
                personas_db["PASAJERO"] = personas_db["colaborador"].fillna(personas_db["PASAJERO"])
                personas_db.drop(columns=["dni", "colaborador"], inplace=True, errors="ignore")
        except Exception:
            pass
        import logging
        _y1p_all = df_asist[df_asist["PLACA"].astype(str).str.strip().str.upper() == "Y1P-032"]
        _y1p_ent = df_entrada[df_entrada["PLACA"] == "Y1P-032"]
        cnt_y1p = len(personas_db[personas_db["PLACA"] == "Y1P-032"])
        logging.info(f"DEBUG Y1P-032: asist_all={len(_y1p_all)}, entrada={len(_y1p_ent)}, personas_db={cnt_y1p}, distinct_dni={_y1p_ent['DNI PASA.'].nunique()}")
        sess["personas"] = personas_db
        sess["asistencia_from_db"] = True
        sess["db_progress"] = {"step": f"Asistencia OK ({len(personas_db):,}). Consultando viajes...", "pct": 85, "done": False, "errors": []}

        # Viajes (rpt_controlbus_viajes_aq1 + aq2) — misma fecha que asistencia
        viajes_emp_where = f""" AND "EMPRESA" = '{empresa}'""" if empresa else ""
        query_viajes = f"""
            SELECT "BUS", "CAPACIDAD","PORCENTAJE OCUP","NRO. PAS. IDA", "ZONA PROCEDENCIA", "CECO", "T.BUS", "RUTA", "TARIFA", "FECHA", "EMPRESA", "PROVEEDOR"
            FROM (
                SELECT "BUS", "CAPACIDAD", "PORCENTAJE OCUP", "NRO. PAS. IDA", "ZONA PROCEDENCIA", "CECO", "T.BUS", "RUTA", "TARIFA", "FECHA", "EMPRESA", "PROVEEDOR"
                FROM rpt_controlbus_viajes_aq1
                UNION ALL
                SELECT "BUS", "CAPACIDAD", "PORCENTAJE OCUP", "NRO. PAS. IDA", "ZONA PROCEDENCIA", "CECO", "T.BUS", "RUTA", "TARIFA", "FECHA", "EMPRESA", "PROVEEDOR"
                FROM rpt_controlbus_viajes_aq2
            ) v
            WHERE {fecha_where}{viajes_emp_where}
        """
        # Debug: ver empresas disponibles en viajes para esta fecha
        debug_q = f"""
            SELECT DISTINCT "EMPRESA" FROM (
                SELECT "EMPRESA", "FECHA" FROM rpt_controlbus_viajes_aq1
                UNION ALL
                SELECT "EMPRESA", "FECHA" FROM rpt_controlbus_viajes_aq2
            ) v WHERE {fecha_where}
        """
        try:
            df_debug = pd.read_sql(debug_q, conn)
            logger.info(f"Empresas en viajes para {fecha}: {df_debug['EMPRESA'].tolist()}")
        except Exception as ex:
            logger.info(f"Debug empresas query failed: {ex}")
        logger.info(f"Query empresa filter: '{empresa}'")

        df_viajes_raw = pd.read_sql(query_viajes, conn)
        logger.info(f"Viajes raw: {len(df_viajes_raw)} rows, columns: {list(df_viajes_raw.columns)}")
        df_viajes_raw["NRO. PAS. IDA"] = pd.to_numeric(df_viajes_raw["NRO. PAS. IDA"], errors="coerce").fillna(0).astype(int)
        df_viajes_raw = df_viajes_raw[
            (df_viajes_raw["NRO. PAS. IDA"] != 0)
            & (df_viajes_raw["CECO"].astype(str).str.contains("COSECHA", case=False, na=False))
        ].copy()
        logger.info(f"Viajes filtered (COSECHA + PAS>0): {len(df_viajes_raw)} rows")
        df_viajes_raw["BUS"] = df_viajes_raw["BUS"].astype(str).str.strip().str.upper()
        df_viajes_raw["CAPACIDAD"] = pd.to_numeric(df_viajes_raw["CAPACIDAD"], errors="coerce").fillna(0).astype(int)
        df_viajes_raw["RUTA"] = df_viajes_raw["RUTA"].fillna("").astype(str).str.strip()
        df_viajes_raw["RUTA"] = df_viajes_raw["RUTA"].replace({"nan": "", "None": ""})
        df_viajes_raw["RUTA"] = df_viajes_raw["RUTA"].apply(_normalizar_ruta)
        viajes_placa = (
            df_viajes_raw.groupby("BUS")
            .agg(
                CAPACIDAD=("CAPACIDAD", "first"),
                PAS_IDA_VIAJES=("NRO. PAS. IDA", "sum"),
                ZONA_PROCEDENCIA=("ZONA PROCEDENCIA", "first"),
                CECO=("CECO", "first"),
                T_BUS=("T.BUS", "first"),
                RUTA=("RUTA", "first"),
                TARIFA=("TARIFA", "sum"),
                EMPRESA=("EMPRESA", "first"),
                PROVEEDOR=("PROVEEDOR", "first"),
                PORCENTAJE_OCUP=("PORCENTAJE OCUP", "first"),
            )
            .reset_index()
        )
        _DESTINOS_AQ2 = {"VIVADIS", "SANTA TERESA", "AYLLU ALLPA"}
        def _planta_from_ruta(ruta):
            if "=>" in str(ruta):
                destino = str(ruta).split("=>")[1].strip().upper()
                if destino in _DESTINOS_AQ2:
                    return "AQ2"
            return "AQ1"
        viajes_placa["PLANTA"] = viajes_placa["RUTA"].apply(_planta_from_ruta)
        sess["viajes_placa"] = viajes_placa
        sess["viajes_from_db"] = True
        sess["db_progress"] = {
            "step": f"Listo ({fecha}). Jarras: {len(df_jarra):,} | Horas: {len(df_actividad):,} | Asistencia: {len(personas_db):,} | Viajes: {len(viajes_placa):,} buses",
            "pct": 100, "done": True, "errors": [],
        }

        conn.close()

    except Exception as e:
        logger.error(f"=== DB LOAD ERROR === {e}", exc_info=True)
        sess["db_progress"]["errors"].append(str(e))
        sess["db_progress"]["step"] = f"Error: {e}"
        sess["db_progress"]["done"] = True


@app.get("/api/db/filters")
def db_filters():
    try:
        conn = _get_db_conn()
        cur = conn.cursor()
        cur.execute('SELECT DISTINCT "EMPRESA" FROM rpt_controlbus_asistencia ORDER BY "EMPRESA"')
        empresas = [r[0] for r in cur.fetchall() if r[0]]
        cur.execute("""
            SELECT DISTINCT "FECHA" FROM rpt_controlbus_asistencia
            WHERE "FECHA" >= CURRENT_DATE - INTERVAL '14 days'
            ORDER BY "FECHA" DESC
        """)
        fechas = [r[0].isoformat() if hasattr(r[0], 'isoformat') else str(r[0]) for r in cur.fetchall() if r[0]]
        conn.close()
        return {"empresas": empresas, "fechas": fechas}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/db/load")
def db_load(req: DBLoadRequest):
    t = threading.Thread(target=_load_db_data, args=(req.session_id, req.fecha, req.fecha_desde, req.fecha_hasta, req.empresa), daemon=True)
    t.start()
    return {"status": "started"}


@app.get("/api/db/progress")
def db_progress(session_id: str = Query("default")):
    sess = get_session(session_id)
    prog = sess.get("db_progress", {"step": "Sin iniciar", "pct": 0, "done": False, "errors": []})
    return {
        **prog,
        "jarras_loaded": "df_jarra" in sess,
        "jarras_count": len(sess["df_jarra"]) if "df_jarra" in sess else 0,
        "actividad_loaded": "df_actividad" in sess,
        "actividad_count": len(sess["df_actividad"]) if "df_actividad" in sess else 0,
    }


@app.get("/api/db/status")
def db_status(session_id: str = Query("default")):
    sess = get_session(session_id)
    return {
        "jarras_loaded": "df_jarra" in sess,
        "jarras_count": len(sess["df_jarra"]) if "df_jarra" in sess else 0,
        "actividad_loaded": "df_actividad" in sess,
        "actividad_count": len(sess["df_actividad"]) if "df_actividad" in sess else 0,
        "asistencia_loaded": "personas" in sess and sess.get("asistencia_from_db"),
        "asistencia_count": len(sess["personas"]) if "personas" in sess else 0,
        "viajes_loaded": "viajes_placa" in sess and sess.get("viajes_from_db"),
        "viajes_count": len(sess["viajes_placa"]) if "viajes_placa" in sess else 0,
    }


# ---------------------------------------------------------------------------
# UPLOAD endpoints
# ---------------------------------------------------------------------------

@app.post("/api/upload/viajes")
async def upload_viajes(session_id: str = Form(...), files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    try:
        dfs = []
        for f in files:
            content = await f.read()
            dfs.append(procesar_viajes(content))
        viajes_placa = pd.concat(dfs, ignore_index=True)
        viajes_placa = viajes_placa.drop_duplicates(subset=["BUS"], keep="first")
        sess = get_session(session_id)
        sess["viajes_placa"] = viajes_placa
        return {"status": "ok", "buses": len(viajes_placa)}
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Error procesando viajes: {e}")


@app.post("/api/upload/asistencia")
async def upload_asistencia(session_id: str = Form(...), file: UploadFile = File(...)):
    try:
        content = await file.read()
        personas = procesar_asistencia(content)
        sess = get_session(session_id)
        sess["personas"] = personas
        sess["asistencia_bytes"] = content  # keep for fecha extraction later
        return {"status": "ok", "personas": len(personas)}
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Error procesando asistencia: {e}")

# ---------------------------------------------------------------------------
# PROCESS endpoint — full cruce logic
# ---------------------------------------------------------------------------

@app.post("/api/process")
def process(req: ProcessRequest):
    sess = get_session(req.session_id)
    viajes_placa = sess.get("viajes_placa")
    personas = sess.get("personas")
    if viajes_placa is None or personas is None:
        _ensure_session_data(sess)
        viajes_placa = sess.get("viajes_placa")
        personas = sess.get("personas")
    if viajes_placa is None or personas is None:
        raise HTTPException(status_code=400, detail="Upload viajes and asistencia first")

    personas = personas.copy()

    # --- Cruzar jarras ---
    df_jarra = sess.get("df_jarra")
    if df_jarra is not None:
        jarra_cols_available = [c for c in ["Dni_Trabajador", "Total Jarras", "FECHA"] if c in df_jarra.columns]
        df_rend = df_jarra[jarra_cols_available].copy()
        df_rend.columns = ["DNI_JARRA", "JARRAS"] + (["FECHA_JARRA"] if "FECHA" in jarra_cols_available else [])
        df_rend["DNI_JARRA"] = df_rend["DNI_JARRA"].astype(str).str.strip()
        df_rend["JARRAS"] = pd.to_numeric(df_rend["JARRAS"], errors="coerce").fillna(0)
        if "FECHA_JARRA" in df_rend.columns:
            jarras_dia = df_rend.groupby(["DNI_JARRA", "FECHA_JARRA"]).agg(JARRAS_DIA=("JARRAS", "sum")).reset_index()
            jarras_prom = jarras_dia.groupby("DNI_JARRA").agg(PROM_JARRAS_SEM=("JARRAS_DIA", "mean")).reset_index()
        else:
            jarras_prom = df_rend.groupby("DNI_JARRA").agg(PROM_JARRAS_SEM=("JARRAS", "mean")).reset_index()
        jarras_prom["PROM_JARRAS_SEM"] = jarras_prom["PROM_JARRAS_SEM"].round(1)
        personas = personas.merge(jarras_prom, left_on="DNI PASA.", right_on="DNI_JARRA", how="left")
        personas["PROM_JARRAS_SEM"] = personas["PROM_JARRAS_SEM"].fillna(0)
        personas.drop(columns=["DNI_JARRA"], inplace=True, errors="ignore")

    # --- Fecha reporte ---
    fecha_reporte = None
    asistencia_bytes = sess.get("asistencia_bytes")
    if asistencia_bytes:
        fecha_reporte = extraer_fecha_reporte(asistencia_bytes)

    # --- Cruzar actividad ---
    df_actividad = sess.get("df_actividad")
    if df_actividad is not None:
        df_act = df_actividad.copy()
        df_act.columns = df_act.columns.str.strip()
        act_cols = df_act.columns.tolist()
        dni_col_act = next((c for c in act_cols if "DOCUMENTO" in c.upper() or "DNI" in c.upper()), None)
        act_col = next((c for c in act_cols if "ACTIVIDAD" in c.upper() or "LABOR" in c.upper()), None)
        fecha_col_act = next((c for c in act_cols if "FECHA" in c.upper()), None)
        if dni_col_act and act_col:
            df_act[dni_col_act] = df_act[dni_col_act].astype(str).str.strip().str.replace(r'\.0$', '', regex=True)
            personas["DNI PASA."] = personas["DNI PASA."].astype(str).str.strip().str.replace(r'\.0$', '', regex=True)
            act_moda = (
                df_act.groupby(dni_col_act)[act_col]
                .agg(lambda x: x.value_counts().index[0] if len(x.value_counts()) > 0 else "")
                .reset_index()
            )
            act_moda.columns = ["DNI_ACT", "ACTIVIDAD"]
            personas = personas.merge(act_moda, left_on="DNI PASA.", right_on="DNI_ACT", how="left")
            personas["ACTIVIDAD"] = personas["ACTIVIDAD"].fillna("")
            personas.drop(columns=["DNI_ACT"], inplace=True, errors="ignore")
            # Fallback: cruzar nombre desde horas para DNIs sin nombre de funcionarios
            if "TRABAJADOR" in df_act.columns:
                mask_sin_nombre = personas["PASAJERO"].astype(str).str.strip().isin(["", "None", "nan", "NaN"])
                if mask_sin_nombre.any():
                    nombres = df_act.drop_duplicates(subset=[dni_col_act], keep="first")[[dni_col_act, "TRABAJADOR"]]
                    nombres.columns = ["DNI_NOM", "PASAJERO_H"]
                    nombres["DNI_NOM"] = nombres["DNI_NOM"].astype(str).str.strip().str.replace(r'\.0$', '', regex=True)
                    personas = personas.merge(nombres, left_on="DNI PASA.", right_on="DNI_NOM", how="left")
                    personas.loc[mask_sin_nombre, "PASAJERO"] = personas.loc[mask_sin_nombre, "PASAJERO_H"]
                    personas["PASAJERO"] = personas["PASAJERO"].fillna("")
                    personas.drop(columns=["DNI_NOM", "PASAJERO_H"], inplace=True, errors="ignore")

    # --- Debug: log count per placa before cruce ---
    import logging
    for p in ["Y1P-032"]:
        cnt = len(personas[personas["PLACA"] == p])
        logging.info(f"DEBUG PLACA {p}: {cnt} personas before cruce")
    # --- Cruce por placa ---
    asist_placa = personas.groupby("PLACA").agg(PAS_REAL=("DNI PASA.", "count")).reset_index()
    cruce = viajes_placa.merge(asist_placa, left_on="BUS", right_on="PLACA", how="left")
    cruce["PAS_REAL"] = cruce["PAS_REAL"].fillna(0).astype(int)
    cruce["ASIENTOS_VACIOS"] = cruce["CAPACIDAD"] - cruce["PAS_REAL"]
    cruce["% OCUP. REAL"] = cruce.apply(
        lambda r: round(r["PAS_REAL"] / r["CAPACIDAD"] * 100, 1) if r["CAPACIDAD"] > 0 else 0, axis=1
    )
    cruce["COSTO_PASAJERO"] = cruce.apply(
        lambda r: round(r["TARIFA"] / r["PAS_REAL"], 2) if r["PAS_REAL"] > 0 else 0, axis=1
    )
    cruce["PERDIDA"] = cruce.apply(
        lambda r: round((r["TARIFA"] / r["CAPACIDAD"]) * r["ASIENTOS_VACIOS"], 2) if r["CAPACIDAD"] > 0 else 0, axis=1
    )
    cruce = cruce.fillna({"RUTA": "", "ZONA_PROCEDENCIA": "", "CECO": "", "T_BUS": "", "PROVEEDOR": "", "PORCENTAJE_OCUP": 0})
    cruce = cruce.sort_values("ASIENTOS_VACIOS", ascending=False)

    # Store for rebalanceo
    sess["cruce"] = cruce
    sess["personas_enriched"] = personas

    # Filter options
    cecos = sorted(cruce["CECO"].dropna().unique().tolist())
    zonas = sorted(cruce["ZONA_PROCEDENCIA"].dropna().unique().tolist())
    placas = sorted(cruce["BUS"].dropna().unique().tolist())

    # Metrics
    metrics = {
        "buses": len(cruce),
        "capacidad": int(cruce["CAPACIDAD"].sum()),
        "pasajeros_reales": int(cruce["PAS_REAL"].sum()),
        "asientos_vacios": int(cruce["ASIENTOS_VACIOS"].sum()),
        "tarifa_total": round(float(cruce["TARIFA"].sum()), 2),
        "perdida_total": round(float(cruce["PERDIDA"].fillna(0).sum()), 2),
    }

    # Personas filtered to only plates in viajes
    placas_viajes = viajes_placa["BUS"].unique().tolist()
    personas_viajes = personas[personas["PLACA"].isin(placas_viajes)]

    return {
        "cruce": _df_to_records(cruce),
        "personas": _df_to_records(personas_viajes),
        "metrics": metrics,
        "filters": {"cecos": cecos, "zonas": zonas, "placas": placas},
        "fecha_reporte": fecha_reporte.isoformat() if fecha_reporte is not None else None,
        "has_jarras": "PROM_JARRAS_SEM" in personas.columns,
        "has_actividad": "ACTIVIDAD" in personas.columns,
        "_debug_placa_counts": {
            p: int(personas[personas["PLACA"] == p].shape[0])
            for p in ["Y1P-032"]
        },
    }

@app.get("/api/debug/cruce")
def debug_cruce():
    if not sessions:
        return {"error": "no sessions"}
    sess = list(sessions.values())[-1]
    cruce = sess.get("cruce")
    if cruce is None:
        return {"error": "no cruce"}
    sample = cruce.head(3).to_dict(orient="records")
    return {"columns": list(cruce.columns), "sample": sample}

@app.get("/api/debug/placa/{placa}")
def debug_placa(placa: str, session_id: str = None):
    if session_id:
        sess = get_session(session_id)
    elif sessions:
        sess = list(sessions.values())[-1]
    else:
        return {"error": "no sessions"}
    personas = sess.get("personas")
    personas_enriched = sess.get("personas_enriched")
    if personas is None:
        return {"error": "no personas loaded"}
    p_raw = personas[personas["PLACA"] == placa.upper()]
    result = {"placa": placa.upper(), "personas_raw_count": len(p_raw), "columns": list(personas.columns)}
    if personas_enriched is not None:
        p_enr = personas_enriched[personas_enriched["PLACA"] == placa.upper()]
        result["personas_enriched_count"] = len(p_enr)
        result["distinct_dni_enriched"] = int(p_enr["DNI PASA."].nunique())
    return result

# ---------------------------------------------------------------------------
# REBALANCEO endpoint
# ---------------------------------------------------------------------------

def _haversine_km(lat1, lng1, lat2, lng2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.asin(math.sqrt(a))


def _get_osrm_route_coords(origin_coords, dest_coords):
    """Fetch OSRM route and return list of (lat, lng) waypoints."""
    try:
        url = f"https://router.project-osrm.org/route/v1/driving/{origin_coords['lng']},{origin_coords['lat']};{dest_coords['lng']},{dest_coords['lat']}?overview=full&geometries=geojson"
        resp = http_requests.get(url, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("routes"):
                coords = data["routes"][0]["geometry"]["coordinates"]
                return [(c[1], c[0]) for c in coords]  # geojson is [lng, lat]
    except Exception as e:
        logger.warning(f"OSRM route fetch failed: {e}")
    return None


def _min_distance_to_route(point_lat, point_lng, route_coords):
    """Min distance in km from a point to any segment of the route."""
    if not route_coords:
        return float('inf')
    min_dist = float('inf')
    for lat, lng in route_coords:
        d = _haversine_km(point_lat, point_lng, lat, lng)
        if d < min_dist:
            min_dist = d
    return min_dist


def _build_route_proximity(cruce, max_desvio_km=15):
    """For each bus, find which zones are within max_desvio_km of its route."""
    import time
    bus_zones_nearby = {}
    route_cache = {}

    for _, row in cruce.iterrows():
        bus = row["BUS"]
        zona = str(_safe(row.get("ZONA_PROCEDENCIA", ""), ""))
        ruta = str(_safe(row.get("RUTA", ""), ""))
        destino = "AQUANQA"
        if "=>" in ruta:
            destino = ruta.split("=>")[1].strip().upper()
            if destino not in DESTINOS_PLANTA:
                destino = "AQUANQA"

        zona_key = zona.upper().strip()
        origin = ZONAS_COORDS.get(zona_key)
        dest = DESTINOS_PLANTA.get(destino)
        if not origin or not dest:
            continue

        cache_key = f"{zona_key}->{destino}"
        if cache_key not in route_cache:
            route_coords = _get_osrm_route_coords(origin, dest)
            route_cache[cache_key] = route_coords
            time.sleep(0.3)
        route_coords = route_cache[cache_key]
        if not route_coords:
            continue

        nearby_zones = set()
        for z_name, z_coords in ZONAS_COORDS.items():
            dist = _min_distance_to_route(z_coords["lat"], z_coords["lng"], route_coords)
            if dist <= max_desvio_km:
                nearby_zones.add(z_name.upper().strip())
        bus_zones_nearby[bus] = nearby_zones

    return bus_zones_nearby


@app.post("/api/rebalanceo")
def rebalanceo(req: RebalanceoRequest):
    sess = get_session(req.session_id)
    umbral = req.umbral
    _ensure_session_data(sess)
    cruce = sess.get("cruce")
    personas = sess.get("personas_enriched")
    if cruce is None or personas is None:
        raise HTTPException(status_code=400, detail="No data available")

    if "PROM_JARRAS_SEM" not in personas.columns:
        personas["PROM_JARRAS_SEM"] = 0

    viajes_placa = sess.get("viajes_placa")
    placas_viajes = viajes_placa["BUS"].unique().tolist() if viajes_placa is not None else []
    personas_viajes = personas[personas["PLACA"].isin(placas_viajes)]

    buses_baja = cruce[cruce["% OCUP. REAL"] < umbral].copy()
    buses_con_espacio = cruce[cruce["ASIENTOS_VACIOS"] > 0].copy()

    if buses_baja.empty:
        return {"recomendaciones": [], "resumen": {"buses_eliminables": 0, "personas_reasignables": 0, "sin_espacio": 0}}

    logger.info("Calculando proximidad de rutas OSRM para rebalanceo...")
    bus_zones_nearby = _build_route_proximity(cruce, max_desvio_km=2)
    logger.info(f"Proximidad calculada para {len(bus_zones_nearby)} buses")

    recomendaciones = []

    def _origen_ruta(ruta):
        r = str(ruta)
        return r.split("=>")[0].strip().upper() if "=>" in r else r.strip().upper()

    # Pre-calcular origen de ruta para candidatos
    buses_con_espacio = buses_con_espacio.copy()
    buses_con_espacio["_ORIGEN_RUTA"] = buses_con_espacio["RUTA"].apply(_origen_ruta)

    for _, bus_b in buses_baja.iterrows():
        placa_baja = bus_b["BUS"]
        ruta_baja = bus_b["RUTA"]
        origen_baja = _origen_ruta(ruta_baja)
        zona_baja = bus_b["ZONA_PROCEDENCIA"]

        personas_bus = personas_viajes[personas_viajes["PLACA"] == placa_baja].copy()
        personas_bus = personas_bus.sort_values("PROM_JARRAS_SEM", ascending=False)

        tarifa_baja = bus_b["TARIFA"]

        cap_baja = bus_b["CAPACIDAD"]

        # Solo recomendar hacia buses de igual o mayor capacidad
        candidatos = buses_con_espacio[buses_con_espacio["CAPACIDAD"] >= cap_baja]

        # Primero: buses con el mismo origen de ruta (prioridad)
        mismo_origen_filter = (
            (candidatos["BUS"] != placa_baja)
            & (candidatos["ASIENTOS_VACIOS"] > 0)
            & (candidatos["_ORIGEN_RUTA"] == origen_baja)
        )
        # Segundo: buses cuya ruta pasa por el origen del bus eliminado (max 2km desvío)
        def _ruta_pasa_por_zona(bus_placa):
            nearby = bus_zones_nearby.get(bus_placa, set())
            return origen_baja in nearby

        ruta_cercana_filter = (
            (candidatos["BUS"] != placa_baja)
            & (candidatos["ASIENTOS_VACIOS"] > 0)
            & (candidatos["_ORIGEN_RUTA"] != origen_baja)
            & (candidatos["BUS"].apply(_ruta_pasa_por_zona))
        )

        destinos_mismo_origen = candidatos[mismo_origen_filter].sort_values("TARIFA").copy()
        destinos_ruta_cercana = candidatos[ruta_cercana_filter].sort_values("TARIFA").copy()
        destinos = pd.concat([destinos_mismo_origen, destinos_ruta_cercana], ignore_index=True)

        asignaciones = []
        espacio_restante = destinos.set_index("BUS")["ASIENTOS_VACIOS"].to_dict()

        for _, persona in personas_bus.iterrows():
            asignado = False
            actividad = persona.get("ACTIVIDAD", "") if "ACTIVIDAD" in personas_bus.columns else ""
            for dest_placa in espacio_restante:
                if espacio_restante[dest_placa] > 0:
                    ceco_dest = ""
                    zona_dest = ""
                    dest_rows = destinos[destinos["BUS"] == dest_placa]
                    if len(dest_rows) > 0:
                        ceco_dest = dest_rows["CECO"].values[0]
                        zona_dest = str(dest_rows["ZONA_PROCEDENCIA"].values[0]) if "ZONA_PROCEDENCIA" in dest_rows.columns else ""
                        if zona_dest in ("None", "nan", "NaN", ""): zona_dest = ""
                    mismo_origen_placas = set(destinos_mismo_origen["BUS"].tolist())
                    tipo = "mismo_origen" if dest_placa in mismo_origen_placas else "parada_en_ruta"
                    asignaciones.append({
                        "DNI": str(_safe(persona["DNI PASA."])),
                        "PASAJERO": str(_safe(persona["PASAJERO"])),
                        "ACTIVIDAD": str(_safe(actividad)),
                        "PROM_JARRAS_SEM": round(float(_safe(persona["PROM_JARRAS_SEM"], 0)), 1),
                        "BUS_ORIGEN": str(placa_baja),
                        "BUS_DESTINO": str(dest_placa),
                        "ZONA_DESTINO": str(_safe(zona_dest, "")),
                        "CECO_DESTINO": str(_safe(ceco_dest)),
                        "TIPO_REASIGNACION": tipo,
                    })
                    espacio_restante[dest_placa] -= 1
                    asignado = True
                    break
            if not asignado:
                asignaciones.append({
                    "DNI": str(_safe(persona["DNI PASA."])),
                    "PASAJERO": str(_safe(persona["PASAJERO"])),
                    "ACTIVIDAD": str(_safe(actividad)),
                    "PROM_JARRAS_SEM": round(float(_safe(persona["PROM_JARRAS_SEM"], 0)), 1),
                    "BUS_ORIGEN": str(placa_baja),
                    "BUS_DESTINO": "SIN ESPACIO",
                    "ZONA_DESTINO": "",
                    "CECO_DESTINO": "",
                })

        recomendaciones.append({
            "placa": placa_baja,
            "ruta": str(_safe(ruta_baja, "")),
            "zona": str(_safe(zona_baja, "")),
            "ceco": str(_safe(bus_b["CECO"], "")),
            "tipo": str(_safe(bus_b["T_BUS"], "")),
            "capacidad": int(bus_b["CAPACIDAD"]),
            "pasajeros": int(bus_b["PAS_REAL"]),
            "ocup": round(float(_safe(bus_b["% OCUP. REAL"], 0)), 1),
            "tarifa": round(float(_safe(bus_b["TARIFA"], 0)), 2),
            "costo_pasajero": round(float(_safe(bus_b["TARIFA"], 0)) / max(int(_safe(bus_b["PAS_REAL"], 0)), 1), 2),
            "perdida": round((float(_safe(bus_b["TARIFA"], 0)) / max(int(_safe(bus_b["CAPACIDAD"], 1)), 1)) * int(_safe(bus_b["ASIENTOS_VACIOS"], 0)), 2),
            "asignaciones": asignaciones,
        })

    recomendaciones.sort(key=lambda r: r["ocup"])
    total_reasignados = sum(len([a for a in r["asignaciones"] if a["BUS_DESTINO"] != "SIN ESPACIO"]) for r in recomendaciones)
    total_sin_espacio = sum(len([a for a in r["asignaciones"] if a["BUS_DESTINO"] == "SIN ESPACIO"]) for r in recomendaciones)

    return {
        "recomendaciones": recomendaciones,
        "resumen": {
            "buses_eliminables": len(recomendaciones),
            "personas_reasignables": total_reasignados,
            "sin_espacio": total_sin_espacio,
            "perdida_total": round(sum(r.get("perdida", 0) for r in recomendaciones), 2),
        },
    }


# ─── Rutas Mapa ────────────────────────────────────────────────────────────
ZONAS_COORDS = {
    "CASA GRANDE": {"lat": -7.7446, "lng": -79.1881},
    "CASAGRANDE": {"lat": -7.7446, "lng": -79.1881},
    "PORVENIR": {"lat": -8.08682061362065, "lng": -79.00359985119874},
    "EL PORVENIR": {"lat": -8.08682061362065, "lng": -79.00359985119874},
    "VERDUN": {"lat": -7.3400, "lng": -79.4650},
    "VERDÚN": {"lat": -7.3400, "lng": -79.4650},
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
    "CHEQUEN": {"lat": -7.22884333748731, "lng": -79.4103921677075},
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
    "HUANCHACO": {"lat": -8.083575147307053, "lng": -79.11404277711053},
}

DESTINOS_PLANTA = {
    "AQUANQA": {"lat": -7.649344490770919, "lng": -79.3511267158635, "nombre": "Arena Azul (Aquanqa)"},
    "VIVADIS": {"lat": -7.650938324603837, "lng": -79.37241288858357, "nombre": "Vivadis"},
    "SANTA TERESA": {"lat": -7.62738903081178, "lng": -79.36579983666103, "nombre": "Santa Teresa"},
    "AYLLU ALLPA": {"lat": -7.603361414765875, "lng": -79.41000235348258, "nombre": "Ayllu Allpa"},
}

@app.get("/api/rutas-mapa")
def rutas_mapa(session_id: str = Query("default")):
    sess = get_session(session_id)
    _ensure_session_data(sess)
    cruce = sess.get("cruce")
    viajes_placa = sess.get("viajes_placa")
    if cruce is None or viajes_placa is None:
        raise HTTPException(status_code=400, detail="No data available")

    rutas = []
    for _, row in cruce.iterrows():
        bus = row["BUS"]
        zona = str(_safe(row.get("ZONA_PROCEDENCIA", ""), ""))
        ruta = str(_safe(row.get("RUTA", ""), ""))

        # Origen = parte izquierda de la ruta
        if "=>" in ruta:
            origen_name = ruta.split("=>")[0].strip().upper()
            destino_name = ruta.split("=>")[1].strip().upper()
        else:
            origen_name = zona.upper().strip()
            destino_name = "AQUANQA"

        if destino_name not in DESTINOS_PLANTA:
            destino_name = "AQUANQA"

        origen_key = origen_name
        origen_coords = ZONAS_COORDS.get(origen_key)
        if not origen_coords:
            logger.info(f"ORIGEN sin coords: '{origen_name}' (key='{origen_key}')")

        rutas.append({
            "placa": bus,
            "ruta": ruta,
            "origen": origen_name,
            "origen_coords": origen_coords,
            "destino": destino_name,
            "zona_procedencia": zona,
            "capacidad": int(_safe(row.get("CAPACIDAD", 0), 0)),
            "pasajeros": int(_safe(row.get("PAS_REAL", 0), 0)),
            "ocupacion": round(float(_safe(row.get("% OCUP. REAL", 0), 0)), 1),
            "tarifa": round(float(_safe(row.get("TARIFA", 0), 0)), 2),
            "tipo_bus": str(_safe(row.get("T_BUS", ""), "")),
        })

    return {
        "destinos": DESTINOS_PLANTA,
        "rutas": rutas,
    }


_paraderos_cache = None

@app.get("/api/paraderos")
def get_paraderos():
    global _paraderos_cache
    if _paraderos_cache is not None:
        return _paraderos_cache

    json_path = os.path.join(os.path.dirname(__file__), "paradas_coords.json")
    if os.path.exists(json_path):
        with open(json_path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        result = {}
        for distrito, paradas in raw.items():
            key = distrito.strip().upper()
            result[key] = {
                "distrito": distrito,
                "coords": ZONAS_COORDS.get(key),
                "paradas": paradas,
            }
        _paraderos_cache = result
        return result

    raise HTTPException(status_code=404, detail="paradas_coords.json not found. Run: python geocode_paradas.py")


@app.get("/api/debug/columns")
def debug_columns():
    try:
        conn = _get_db_conn()
        df1 = pd.read_sql("SELECT * FROM rpt_controlbus_viajes_aq1 LIMIT 1", conn)
        df2 = pd.read_sql("SELECT * FROM rpt_controlbus_viajes_aq2 LIMIT 1", conn)
        conn.close()
        return {"aq1": list(df1.columns), "aq2": list(df2.columns)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/debug/rutas")
def debug_rutas():
    """List all unique RUTA values from the DB for cleanup analysis."""
    try:
        conn = _get_db_conn()
        query = """
            SELECT DISTINCT "RUTA" FROM (
                SELECT "RUTA" FROM rpt_controlbus_viajes_aq1
                UNION ALL
                SELECT "RUTA" FROM rpt_controlbus_viajes_aq2
            ) v
            WHERE "RUTA" IS NOT NULL AND "RUTA" != ''
            ORDER BY "RUTA"
        """
        df = pd.read_sql(query, conn)
        conn.close()
        return {"rutas": df["RUTA"].tolist(), "total": len(df)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Facilito (Precios Combustible) ─────────────────────────────────────────
try:
    from facilito_scraper import (
        scrape_departamento, scrape_peru, get_progress as get_facilito_progress,
        DEPARTAMENTOS, PRODUCTOS,
    )
    _FACILITO_AVAILABLE = True
except ImportError:
    _FACILITO_AVAILABLE = False
    DEPARTAMENTOS = {}
    PRODUCTOS = {}


@app.get("/api/facilito/departamentos")
def facilito_departamentos():
    return [{"value": v, "text": k} for k, v in sorted(DEPARTAMENTOS.items(), key=lambda x: x[0])]


@app.get("/api/facilito/productos")
def facilito_productos():
    return [{"value": v, "text": k} for k, v in PRODUCTOS.items()]


class FacilitoRequest(BaseModel):
    departamentos: list[str] = ["130000", "140000"]  # La Libertad + Lambayeque por defecto
    session_id: str = "default"


def _run_facilito_bg(departamentos: list, session_id: str):
    loop = asyncio.new_event_loop()
    result = loop.run_until_complete(scrape_peru(session_id, departamentos=departamentos))
    sess = get_session(session_id)
    sess["facilito_data"] = result
    loop.close()


@app.post("/api/facilito/scrape")
def facilito_scrape(req: FacilitoRequest):
    """Scrape precios de La Libertad + Lambayeque (default)."""
    t = threading.Thread(target=_run_facilito_bg, args=(req.departamentos, req.session_id), daemon=True)
    t.start()
    return {"status": "started", "departamentos": len(req.departamentos)}


@app.get("/api/facilito/progress")
def facilito_progress_ep(session_id: str = Query("default")):
    prog = get_facilito_progress(session_id)
    sess = get_session(session_id)
    return {
        **prog,
        "total_rows": len(sess.get("facilito_data", [])),
    }


@app.get("/api/facilito/data")
def facilito_data(
    session_id: str = Query("default"),
    departamento: str = Query(""),
    provincia: str = Query(""),
    producto: str = Query(""),
):
    """Get scraped data with optional filters."""
    sess = get_session(session_id)
    data = sess.get("facilito_data", [])
    if departamento:
        data = [r for r in data if r.get("departamento", "").upper() == departamento.upper()]
    if provincia:
        data = [r for r in data if r.get("provincia", "").upper() == provincia.upper()]
    if producto:
        data = [r for r in data if r.get("producto", "").upper() == producto.upper()]
    return {"rows": data, "total": len(data)}
