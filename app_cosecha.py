import streamlit as st
import pandas as pd
import io
import msal
import urllib.request
import urllib.parse

st.set_page_config(page_title="Optimización Transporte Cosecha", layout="wide")
st.title("Optimización de Transporte - Cosecha")

# ==========================================
# SharePoint Auth - MSAL Device Flow
# ==========================================
_MSAL_CLIENT_ID = "d3590ed6-52b3-4102-aeff-aad2292ab01c"
_MSAL_AUTHORITY = "https://login.microsoftonline.com/common"
_MSAL_SCOPES = ["https://graph.microsoft.com/Files.Read.All"]

_SP_HOST = "aquanqape.sharepoint.com"
_SP_SITE_PATH = "/sites/OficinasPrizePeru"
_SP_FILE_PATH = "PowerBI Global/04.-BI-Division Administrativo/11.-Control Operacional/VistasCtrlOpe/vista_jarra_completa.xlsx"
_SP_REND_PATH = "PowerBI Global/04.-BI-Division Administrativo/11.-Control Operacional/2.-Reporte Formato Jarra/_RendimientoCosecha_V2.xlsx"


@st.cache_resource
def _get_msal_app():
    return msal.PublicClientApplication(
        client_id=_MSAL_CLIENT_ID,
        authority=_MSAL_AUTHORITY,
    )


def _graph_get(url: str, token: str) -> dict:
    import json
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def _graph_download(url: str, token: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}"},
    )
    opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler())
    with opener.open(req) as resp:
        return resp.read()


def _descargar_jarra(token: str):
    site_url = f"https://graph.microsoft.com/v1.0/sites/{_SP_HOST}:{_SP_SITE_PATH}"
    site = _graph_get(site_url, token)
    site_id = site["id"]

    drives_url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives"
    drives = _graph_get(drives_url, token)
    drive = next(
        (d for d in drives["value"]
         if "documento" in d["name"].lower() or "document" in d["name"].lower()),
        drives["value"][0],
    )
    drive_id = drive["id"]

    file_enc = urllib.parse.quote(_SP_FILE_PATH)
    dl_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{file_enc}:/content"
    return _graph_download(dl_url, token)


def _descargar_rendimiento(token: str):
    site_url = f"https://graph.microsoft.com/v1.0/sites/{_SP_HOST}:{_SP_SITE_PATH}"
    site = _graph_get(site_url, token)
    site_id = site["id"]

    drives_url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives"
    drives = _graph_get(drives_url, token)
    drive = next(
        (d for d in drives["value"]
         if "documento" in d["name"].lower() or "document" in d["name"].lower()),
        drives["value"][0],
    )
    drive_id = drive["id"]

    file_enc = urllib.parse.quote(_SP_REND_PATH)
    dl_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{file_enc}:/content"
    return _graph_download(dl_url, token)


def _get_graph_token():
    app = _get_msal_app()
    accounts = app.get_accounts()
    result = app.acquire_token_silent(_MSAL_SCOPES, account=accounts[0]) if accounts else None
    if result and "access_token" in result:
        return result["access_token"]

    flow = app.initiate_device_flow(scopes=_MSAL_SCOPES)
    st.warning(
        f"**Autenticación requerida** — "
        f"Ve a [microsoft.com/devicelogin](https://microsoft.com/devicelogin) "
        f"e ingresa el código: **`{flow['user_code']}`**"
    )
    with st.spinner("Esperando autenticación..."):
        result = app.acquire_token_by_device_flow(flow)

    if "access_token" not in result:
        st.error(f"Error de autenticación: {result.get('error_description', result)}")
        return None
    return result["access_token"]


# --- Sidebar: Login SharePoint ---
with st.sidebar:
    st.header("SharePoint - Rendimientos")

    if "df_jarra" not in st.session_state:
        st.session_state.df_jarra = None
    if "df_actividad" not in st.session_state:
        st.session_state.df_actividad = None

    if st.session_state.df_jarra is not None:
        st.success("Conectado a SharePoint")
        st.write(f"Registros jarra: {len(st.session_state.df_jarra)}")
        if st.session_state.df_actividad is not None:
            st.write(f"Registros actividad: {len(st.session_state.df_actividad)}")
        if st.button("Recargar datos"):
            st.session_state.df_jarra = None
            st.session_state.df_actividad = None
            st.rerun()
    else:
        if st.button("Conectar con Microsoft"):
            token = _get_graph_token()
            if token:
                try:
                    content = _descargar_jarra(token)
                    df = pd.read_excel(
                        io.BytesIO(content),
                        usecols=["Dni_Trabajador", "Trabajador", "Total Jarras", "FECHA", "SEMANA"],
                    )
                    st.session_state.df_jarra = df
                    st.success("Jarras descargado")
                except Exception as e:
                    st.error(f"Error descargando jarras: {e}")

                try:
                    content_rend = _descargar_rendimiento(token)
                    dfs = []
                    for hoja in ["Horas-AQ1_V2", "Horas-AQ2_V2"]:
                        try:
                            df_h = pd.read_excel(io.BytesIO(content_rend), sheet_name=hoja, header=None, nrows=5)
                            hdr = 0
                            for rr in range(min(5, len(df_h))):
                                vals = df_h.iloc[rr].astype(str).str.upper().tolist()
                                if any("DOCUMENTO" in v or "DNI" in v for v in vals):
                                    hdr = rr
                                    break
                            df_h = pd.read_excel(io.BytesIO(content_rend), sheet_name=hoja, header=hdr)
                            df_h.columns = df_h.columns.str.strip()
                            cols_keep = [c for c in df_h.columns if any(k in c.upper() for k in ["DOCUMENTO", "ACTIVIDAD", "LABOR", "FECHA"])]
                            df_h = df_h[cols_keep]
                            dfs.append(df_h)
                        except Exception:
                            pass
                    if dfs:
                        df_act = pd.concat(dfs, ignore_index=True)
                        st.session_state.df_actividad = df_act
                        st.success("Actividad descargado")
                    else:
                        st.warning("No se encontraron hojas Horas-AQ1_V2 / Horas-AQ2_V2")
                except Exception as e:
                    st.error(f"Error descargando actividad: {e}")

                st.rerun()

# ==========================================
# Uploaders principales
# ==========================================
col1, col2 = st.columns(2)

with col1:
    st.subheader("RptViajesRealizados")
    files_viajes = st.file_uploader("Sube los reportes de viajes (1 o 2 archivos)", type=["xlsx"], key="viajes", accept_multiple_files=True)

with col2:
    st.subheader("RptRegistroAsistencia")
    file_asistencia = st.file_uploader("Sube el reporte de asistencia", type=["xlsx"], key="asistencia")

@st.cache_data(show_spinner="Procesando viajes...")
def procesar_viajes(file_bytes):
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
    df_ida["RUTA"] = df_ida["RUTA"].astype(str).str.strip()
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


@st.cache_data(show_spinner="Procesando asistencia...")
def procesar_asistencia(file_bytes):
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
        raise ValueError(f"No se encontró columna TIPO. Columnas: {list(df.columns)[:10]}")
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


if files_viajes and file_asistencia:
    try:
        # Procesar y unir múltiples archivos de viajes
        dfs_viajes = [procesar_viajes(f.getvalue()) for f in files_viajes]
        viajes_placa = pd.concat(dfs_viajes, ignore_index=True)
        viajes_placa = viajes_placa.drop_duplicates(subset=["BUS"], keep="first")
    except Exception as e:
        st.error(f"Error procesando viajes: {e}")
        st.stop()
    try:
        personas = procesar_asistencia(file_asistencia.getvalue())
    except Exception as e:
        st.error(f"Error procesando asistencia: {e}")
        st.stop()

    st.info(f"Viajes: {len(viajes_placa)} buses | Asistencia: {len(personas)} personas")

    # --- Cruzar rendimiento de jarra si está disponible ---
    st.sidebar.write("LOG: Inicio cruce jarras")
    df_jarra = st.session_state.get("df_jarra")
    if df_jarra is not None:
        df_rend = df_jarra[["Dni_Trabajador", "Total Jarras", "FECHA", "SEMANA"]].copy()
        df_rend.columns = ["DNI_JARRA", "JARRAS", "FECHA_JARRA", "SEMANA_JARRA"]
        df_rend["DNI_JARRA"] = df_rend["DNI_JARRA"].astype(str).str.strip()
        df_rend["JARRAS"] = pd.to_numeric(df_rend["JARRAS"], errors="coerce").fillna(0)
        df_rend["SEMANA_JARRA"] = df_rend["SEMANA_JARRA"].astype(str).str.strip()
        semana_actual = df_rend["SEMANA_JARRA"].dropna().iloc[-1] if len(df_rend) > 0 else None
        if semana_actual:
            df_rend = df_rend[df_rend["SEMANA_JARRA"] == semana_actual]
        # Suma de jarras por día, luego promedio semanal
        jarras_dia = df_rend.groupby(["DNI_JARRA", "FECHA_JARRA"]).agg(JARRAS_DIA=("JARRAS", "sum")).reset_index()
        jarras_prom = jarras_dia.groupby("DNI_JARRA").agg(PROM_JARRAS_SEM=("JARRAS_DIA", "mean")).reset_index()
        jarras_prom["PROM_JARRAS_SEM"] = jarras_prom["PROM_JARRAS_SEM"].round(1)
        personas = personas.merge(jarras_prom, left_on="DNI PASA.", right_on="DNI_JARRA", how="left")
        personas["PROM_JARRAS_SEM"] = personas["PROM_JARRAS_SEM"].fillna(0)
        personas.drop(columns=["DNI_JARRA"], inplace=True, errors="ignore")

    st.sidebar.write("LOG: Jarras cruzado OK")
    # --- Obtener fecha del reporte de asistencia ---
    fecha_reporte = None
    try:
        xls_f = pd.ExcelFile(file_asistencia)
        sheet_f = "DATA" if "DATA" in xls_f.sheet_names else xls_f.sheet_names[0]
        df_asist_fecha = pd.read_excel(xls_f, sheet_name=sheet_f, header=None, nrows=10)
        sk_f = 0
        for rr in range(min(10, len(df_asist_fecha))):
            if "FECHA" in df_asist_fecha.iloc[rr].astype(str).str.upper().tolist():
                sk_f = rr
                break
        df_fecha_tmp = pd.read_excel(xls_f, sheet_name=sheet_f, header=sk_f, usecols=["FECHA"])
        df_fecha_tmp.columns = df_fecha_tmp.columns.str.strip()
        fecha_reporte = pd.to_datetime(df_fecha_tmp["FECHA"], dayfirst=True, errors="coerce").dropna().iloc[0]
    except Exception:
        pass

    st.sidebar.write(f"LOG: Fecha reporte = {fecha_reporte}")
    # --- Cruzar actividad principal desde RendimientoCosecha (por fecha) ---
    df_actividad = st.session_state.get("df_actividad")
    if df_actividad is not None:
        df_act = df_actividad.copy()
        df_act.columns = df_act.columns.str.strip()
        act_cols = df_act.columns.tolist()
        dni_col_act = next((c for c in act_cols if "DOCUMENTO" in c.upper() or "DNI" in c.upper()), None)
        act_col = next((c for c in act_cols if "ACTIVIDAD" in c.upper() or "LABOR" in c.upper()), None)
        fecha_col_act = next((c for c in act_cols if "FECHA" in c.upper()), None)
        if dni_col_act and act_col:
            df_act[dni_col_act] = df_act[dni_col_act].astype(str).str.strip()
            # Filtrar por fecha del reporte de asistencia
            if fecha_col_act and fecha_reporte is not None:
                df_act[fecha_col_act] = pd.to_datetime(df_act[fecha_col_act], dayfirst=True, errors="coerce")
                df_act = df_act[df_act[fecha_col_act] == fecha_reporte]
            # Actividad más frecuente por persona (en esa fecha)
            act_moda = (
                df_act.groupby(dni_col_act)[act_col]
                .agg(lambda x: x.value_counts().index[0] if len(x.value_counts()) > 0 else "")
                .reset_index()
            )
            act_moda.columns = ["DNI_ACT", "ACTIVIDAD"]
            personas = personas.merge(act_moda, left_on="DNI PASA.", right_on="DNI_ACT", how="left")
            personas["ACTIVIDAD"] = personas["ACTIVIDAD"].fillna("")
            personas.drop(columns=["DNI_ACT"], inplace=True, errors="ignore")
            if fecha_reporte is not None:
                st.sidebar.info(f"Fecha reporte: {fecha_reporte.strftime('%d/%m/%Y')} | Registros actividad filtrados: {len(df_act)} | Matches: {personas['ACTIVIDAD'].ne('').sum()}")
            else:
                st.sidebar.info(f"Sin fecha reporte | Registros actividad: {len(df_act)} | Matches: {personas['ACTIVIDAD'].ne('').sum()}")
        else:
            st.sidebar.warning(f"Columnas actividad no encontradas. Cols: {act_cols[:15]}")

    st.sidebar.write("LOG: Actividad cruzada OK")
    asist_placa = (
        personas.groupby("PLACA")
        .agg(PAS_REAL=("DNI PASA.", "nunique"))
        .reset_index()
    )

    # --- CRUCE por PLACA ---
    cruce = viajes_placa.merge(asist_placa, left_on="BUS", right_on="PLACA", how="left")
    cruce["PAS_REAL"] = cruce["PAS_REAL"].fillna(0).astype(int)
    cruce["ASIENTOS_VACIOS"] = cruce["CAPACIDAD"] - cruce["PAS_REAL"]
    cruce["% OCUP. REAL"] = cruce.apply(
        lambda r: round(r["PAS_REAL"] / r["CAPACIDAD"] * 100, 1) if r["CAPACIDAD"] > 0 else 0, axis=1
    )
    cruce = cruce.sort_values("ASIENTOS_VACIOS", ascending=False)

    st.sidebar.write(f"LOG: Cruce OK - {len(cruce)} filas")
    # --- FILTROS ---
    st.markdown("---")
    f1, f2, f3 = st.columns(3)
    cecos = ["Todos"] + sorted(cruce["CECO"].dropna().unique().tolist())
    zonas = ["Todos"] + sorted(cruce["ZONA_PROCEDENCIA"].dropna().unique().tolist())
    placas_filtro = ["Todos"] + sorted(cruce["BUS"].dropna().unique().tolist())
    filtro_ceco = f1.selectbox("CECO", cecos)
    filtro_zona = f2.selectbox("Zona Procedencia", zonas)
    filtro_placa = f3.selectbox("Placa", placas_filtro)

    df_filtrado = cruce.copy()
    if filtro_ceco != "Todos":
        df_filtrado = df_filtrado[df_filtrado["CECO"] == filtro_ceco]
    if filtro_zona != "Todos":
        df_filtrado = df_filtrado[df_filtrado["ZONA_PROCEDENCIA"] == filtro_zona]
    if filtro_placa != "Todos":
        df_filtrado = df_filtrado[df_filtrado["BUS"] == filtro_placa]

    # --- METRICAS ---
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Buses", len(df_filtrado))
    m2.metric("Capacidad", int(df_filtrado["CAPACIDAD"].sum()))
    m3.metric("Pasajeros reales", int(df_filtrado["PAS_REAL"].sum()))
    m4.metric("Asientos vacíos", int(df_filtrado["ASIENTOS_VACIOS"].sum()))

    # --- TABLA CRUCE ---
    st.subheader("Cruce por PLACA: Capacidad vs Pasajeros Reales")
    st.dataframe(
        df_filtrado[["BUS", "T_BUS", "RUTA", "ZONA_PROCEDENCIA", "CECO", "CAPACIDAD", "PAS_IDA_VIAJES", "PAS_REAL", "ASIENTOS_VACIOS", "% OCUP. REAL", "TARIFA"]].rename(columns={"BUS": "PLACA"}),
        width="stretch",
        hide_index=True,
    )

    # --- DETALLE PERSONAS: solo placas de viajes realizados ---
    st.subheader("Detalle: Personas por PLACA (solo placas de Viajes Realizados)")
    placas_viajes = sorted(viajes_placa["BUS"].unique().tolist())
    personas_viajes = personas[personas["PLACA"].isin(placas_viajes)]
    placa_det = st.selectbox("Selecciona placa", placas_viajes, key="placa_det")

    det = personas_viajes[personas_viajes["PLACA"] == placa_det].copy()
    info_bus = viajes_placa[viajes_placa["BUS"] == placa_det]
    if not info_bus.empty:
        r = info_bus.iloc[0]
        st.write(f"**{r['T_BUS']}** | {r['ZONA_PROCEDENCIA']} → {r['CECO']} | Capacidad: **{r['CAPACIDAD']}** | PAS IDA (reporte): **{r['PAS_IDA_VIAJES']}** | PAS real (asistencia): **{len(det)}**")
    else:
        st.write(f"**{len(det)} personas únicas**")

    cols_det = ["DNI PASA.", "PASAJERO", "PLACA"]
    if "ACTIVIDAD" in det.columns:
        cols_det.append("ACTIVIDAD")
    has_jarra = "PROM_JARRAS_SEM" in det.columns
    if has_jarra:
        cols_det.append("PROM_JARRAS_SEM")

    st.dataframe(det[cols_det], width="stretch", hide_index=True)

    # ==========================================================
    # REBALANCEO: sugerir eliminación de buses con baja ocupación
    # ==========================================================
    has_jarra_global = "PROM_JARRAS_SEM" in personas.columns
    if has_jarra_global:
        st.markdown("---")
        st.subheader("Sugerencia de Rebalanceo")
        st.caption("Buses con baja ocupación → redistribuir pasajeros de mayor rendimiento a buses con espacio del mismo origen")

        umbral = st.slider("Umbral de ocupación para marcar como BAJA (%)", 30, 90, 70, 5)

        buses_baja = cruce[cruce["% OCUP. REAL"] < umbral].copy()
        buses_con_espacio = cruce[cruce["ASIENTOS_VACIOS"] > 0].copy()

        if buses_baja.empty:
            st.success(f"No hay buses con ocupación menor a {umbral}%")
        else:
            st.warning(f"**{len(buses_baja)} buses** con ocupación menor a {umbral}%")

            recomendaciones = []

            for _, bus_b in buses_baja.iterrows():
                placa_baja = bus_b["BUS"]
                ruta_baja = bus_b["RUTA"]
                zona_baja = bus_b["ZONA_PROCEDENCIA"]
                ceco_baja = bus_b["CECO"]
                cap_baja = bus_b["CAPACIDAD"]
                pas_baja = bus_b["PAS_REAL"]

                # Personas de este bus, ordenadas por rendimiento DESC
                personas_bus = personas_viajes[personas_viajes["PLACA"] == placa_baja].copy()
                personas_bus = personas_bus.sort_values("PROM_JARRAS_SEM", ascending=False)

                # Extraer el origen de la ruta (parte antes de "=>")
                origen_ruta = ruta_baja.split("=>")[0].strip().upper() if "=>" in ruta_baja else zona_baja

                # 1. Buscar buses con la misma ruta exacta
                destinos = buses_con_espacio[
                    (buses_con_espacio["RUTA"] == ruta_baja)
                    & (buses_con_espacio["BUS"] != placa_baja)
                    & (buses_con_espacio["ASIENTOS_VACIOS"] > 0)
                ].copy()

                if destinos.empty:
                    # 2. Buscar buses del mismo origen (misma zona procedencia)
                    destinos = buses_con_espacio[
                        (buses_con_espacio["ZONA_PROCEDENCIA"] == zona_baja)
                        & (buses_con_espacio["BUS"] != placa_baja)
                        & (buses_con_espacio["ASIENTOS_VACIOS"] > 0)
                    ].copy()

                # No buscar por CECO — solo misma ruta o zona procedencia

                asignaciones = []
                espacio_restante = destinos.set_index("BUS")["ASIENTOS_VACIOS"].to_dict()

                for _, persona in personas_bus.iterrows():
                    asignado = False
                    actividad = persona.get("ACTIVIDAD", "") if "ACTIVIDAD" in personas_bus.columns else ""
                    for dest_placa in espacio_restante:
                        if espacio_restante[dest_placa] > 0:
                            asignaciones.append({
                                "DNI": persona["DNI PASA."],
                                "PASAJERO": persona["PASAJERO"],
                                "ACTIVIDAD": actividad,
                                "PROM_JARRAS_SEM": round(persona["PROM_JARRAS_SEM"], 1),
                                "BUS_ORIGEN": placa_baja,
                                "BUS_DESTINO": dest_placa,
                                "CECO_DESTINO": destinos[destinos["BUS"] == dest_placa]["CECO"].values[0] if len(destinos[destinos["BUS"] == dest_placa]) > 0 else "",
                            })
                            espacio_restante[dest_placa] -= 1
                            asignado = True
                            break
                    if not asignado:
                        asignaciones.append({
                            "DNI": persona["DNI PASA."],
                            "PASAJERO": persona["PASAJERO"],
                            "ACTIVIDAD": actividad,
                            "PROM_JARRAS_SEM": round(persona["PROM_JARRAS_SEM"], 1),
                            "BUS_ORIGEN": placa_baja,
                            "BUS_DESTINO": "SIN ESPACIO",
                            "CECO_DESTINO": "",
                        })

                recomendaciones.append({
                    "placa": placa_baja,
                    "ruta": ruta_baja,
                    "zona": zona_baja,
                    "ceco": ceco_baja,
                    "tipo": bus_b["T_BUS"],
                    "capacidad": cap_baja,
                    "pasajeros": pas_baja,
                    "ocup": bus_b["% OCUP. REAL"],
                    "asignaciones": asignaciones,
                })

            for rec in recomendaciones:
                with st.expander(
                    f"BAJA: {rec['placa']} | {rec['tipo']} | {rec['ruta']} | "
                    f"Ocup: {rec['ocup']}% ({rec['pasajeros']}/{rec['capacidad']})"
                ):
                    df_asig = pd.DataFrame(rec["asignaciones"])
                    if not df_asig.empty:
                        reasignados = df_asig[df_asig["BUS_DESTINO"] != "SIN ESPACIO"]
                        sin_espacio = df_asig[df_asig["BUS_DESTINO"] == "SIN ESPACIO"]

                        if not reasignados.empty:
                            st.write(f"**{len(reasignados)} personas reasignables** (ordenadas por mayor rendimiento):")
                            st.dataframe(reasignados, width="stretch", hide_index=True)

                        if not sin_espacio.empty:
                            st.error(f"{len(sin_espacio)} personas sin bus destino disponible")
                            st.dataframe(sin_espacio[["DNI", "PASAJERO", "PROM_JARRAS_SEM"]], width="stretch", hide_index=True)

                        destinos_usados = reasignados["BUS_DESTINO"].unique() if not reasignados.empty else []
                        if len(destinos_usados) > 0:
                            st.write("**Buses destino utilizados:**")
                            for dp in destinos_usados:
                                info_d = cruce[cruce["BUS"] == dp]
                                if not info_d.empty:
                                    rd = info_d.iloc[0]
                                    cant = len(reasignados[reasignados["BUS_DESTINO"] == dp])
                                    st.write(f"  - {dp} ({rd['T_BUS']}) | {rd['ZONA_PROCEDENCIA']} → {rd['CECO']} | Espacio: {rd['ASIENTOS_VACIOS']} → recibe {cant}")

            # Resumen
            total_eliminables = len(recomendaciones)
            total_reasignados = sum(
                len([a for a in r["asignaciones"] if a["BUS_DESTINO"] != "SIN ESPACIO"])
                for r in recomendaciones
            )
            total_sin_espacio = sum(
                len([a for a in r["asignaciones"] if a["BUS_DESTINO"] == "SIN ESPACIO"])
                for r in recomendaciones
            )
            st.markdown("---")
            r1, r2, r3 = st.columns(3)
            r1.metric("Buses eliminables", total_eliminables)
            r2.metric("Personas reasignables", total_reasignados)
            r3.metric("Sin espacio", total_sin_espacio)

elif files_viajes or file_asistencia:
    st.info("Sube ambos archivos para ver el cruce.")
