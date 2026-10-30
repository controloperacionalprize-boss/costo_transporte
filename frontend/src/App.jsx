import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Bar, BarChart, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Line, Legend, AreaChart, Area, ComposedChart, Cell } from 'recharts';

const SESSION_ID = crypto.randomUUID();

// ─── Tipos de bus y combustible ───────────────────────────────────────────
const TIPOS_BUS = [
  { label: 'Todos los buses', capMin: 0, capMax: 999, rendimiento: 5.5, mantKm: 0.30, deprecKm: 0.18, chofer: 70, seguro: 12 },
  { label: 'Minibus (15-20 pas)', capMin: 15, capMax: 20, rendimiento: 9, mantKm: 0.18, deprecKm: 0.10, chofer: 50, seguro: 8 },
  { label: 'Microbus (21-30 pas)', capMin: 21, capMax: 30, rendimiento: 7, mantKm: 0.25, deprecKm: 0.13, chofer: 60, seguro: 10 },
  { label: 'Bus mediano (31-40 pas)', capMin: 31, capMax: 40, rendimiento: 5.5, mantKm: 0.30, deprecKm: 0.18, chofer: 70, seguro: 12 },
  { label: 'Bus grande (41-55 pas)', capMin: 41, capMax: 55, rendimiento: 4.5, mantKm: 0.40, deprecKm: 0.23, chofer: 85, seguro: 15 },
  { label: 'Bus doble piso (56+ pas)', capMin: 56, capMax: 999, rendimiento: 3.5, mantKm: 0.50, deprecKm: 0.28, chofer: 100, seguro: 18 },
];

// Peajes conocidos por zona (ida, tarifa bus/camión en S/)
// Fuente: tarifas COVIPERU / Autopista del Sol — ajustar según realidad
const PEAJES_POR_ZONA = {
  'CHICLAYO': 45.00,       // Mocce + Chicama
  'POMALCA': 45.00,
  'CHEPEN': 30.00,         // Chicama
  'GUADALUPE': 25.00,      // Chicama
  'PACASMAYO': 25.00,      // Chicama
  'PACANGUILLA': 25.00,
  'JEQUETEPEQUE': 25.00,
  'SAN PEDRO DE LLOC': 20.00,
  'LIMONCARRO': 25.00,
  'CHEQUEN': 15.00,
  'PAIJAN': 10.00,
  'CASA GRANDE': 0,
  'CHICAMA': 0,
  'CHOCOPE': 0,
  'SANTIAGO DE CAO': 0,
  'CARTAVIO': 0,
  'SAUSAL': 0,
  'CHIQUITOY': 0,
  'MACABI': 0,
  'VERDUN': 0,
  'ROMA': 0,
  'TRUJILLO': 10.00,       // Peaje El Milagro
  'ALTO TRUJILLO': 10.00,
  'EL MILAGRO': 10.00,
  'LA ESPERANZA': 10.00,
  'PORVENIR': 10.00,
  'MANUEL AREVALO': 10.00,
  'ALTO MOCHE': 10.00,
  'BUENOS AIRES': 10.00,
  'HUANCHACO': 10.00,
  'LAREDO': 10.00,
  'CIUDAD DE DIOS': 0,
  'OTUZCO': 10.00,
  'VIRU': 10.00,
  'CHAO': 10.00,
  'SALAVERRY': 10.00,
};

const ZONA_A_SECTOR = {
  'OTUZCO': 'SUR II', 'TRIGOPAMPA': 'SUR II', 'SAN VICENTE': 'SUR II', 'CHAO': 'SUR II', 'VIRU': 'SUR II', 'SAN IGNACIO': 'SUR II',
  'CARTAVIO': 'LOCAL', 'CASA GRANDE': 'LOCAL', 'CHICAMA': 'LOCAL', 'CHIQUITOY': 'LOCAL', 'PAIJAN': 'LOCAL', 'MACABI': 'LOCAL', 'MACABÍ': 'LOCAL',
  'LICAPA': 'LOCAL', 'CHUIN': 'LOCAL', 'PUERTO MALABRIGO': 'LOCAL', 'ROMA': 'LOCAL', 'SANTIAGO DE CAO': 'LOCAL', 'SAUSAL': 'LOCAL', 'ASCOPE': 'LOCAL',
  'CIUDAD DE DIOS': 'NORTE', 'GUADALUPE': 'NORTE', 'PACANGUILLA': 'NORTE', 'PACASMAYO': 'NORTE', 'VERDÚN': 'NORTE', 'VERDUN': 'NORTE',
  'JEQUETEPEQUE': 'NORTE', 'CHEQUÉN': 'NORTE', 'CHEQUEN': 'NORTE', 'SEMAN': 'NORTE', 'LIMONCARRO': 'NORTE',
  'TRUJILLO': 'SUR', 'ALTO TRUJILLO': 'SUR', 'LA ESPERANZA': 'SUR', 'LAREDO': 'SUR', 'PORVENIR': 'SUR',
  'MANUEL AREVALO': 'SUR', 'ALTO MOCHE': 'SUR', 'EL MILAGRO': 'SUR',
  'CHICLAYO': 'NORTE II', 'POMALCA': 'NORTE II', 'JOSE LEONARDO ORTIZ': 'NORTE II', 'CALETA SANTA ROSA': 'NORTE II', 'CALETA SAN JOSE': 'NORTE II',
};

const SECTOR_COLORS = {
  'LOCAL': '#3b82f6',
  'NORTE': '#16a34a',
  'NORTE II': '#9333ea',
  'SUR': '#ea580c',
  'SUR II': '#dc2626',
};

const TIPOS_COMBUSTIBLE = [
  { label: 'Diesel B5 S-50', key: 'DB5 S-50 UV', rendimientoFactor: 1 },
  { label: 'Gasohol 90 (Regular)', key: 'GASOHOL REGULAR', rendimientoFactor: 0.75 },
  { label: 'Gasohol 95 (Premium)', key: 'GASOHOL PREMIUM', rendimientoFactor: 0.7 },
];

function api(path, opts = {}) {
  return fetch(path, opts).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
}

function occColor(pct) {
  if (pct >= 80) return 'var(--green)';
  if (pct >= 50) return 'var(--yellow)';
  return 'var(--red)';
}

function formatNum(n) {
  if (n == null) return '-';
  if (typeof n === 'string') return n;
  const num = Number(n);
  if (isNaN(num)) return '0';
  return num.toLocaleString('es-PE');
}

// ─── MultiSelect Dropdown ─────────────────────────────────────────────────
function MultiSelectFilter({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const toggle = val => {
    onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]);
  };
  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 150 }}>
      <button onClick={() => setOpen(!open)} style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', background: 'var(--bg-card, #fff)', color: 'var(--text, #1f2937)', fontSize: 13, cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected.length === 0 ? label : `${selected.length} seleccionado${selected.length > 1 ? 's' : ''}`}
        </span>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'}`} style={{ fontSize: 10, marginLeft: 6, color: 'var(--text-dim)' }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--bg-card, #fff)', border: '1px solid var(--border, #d1d5db)', borderRadius: 6, marginTop: 2, maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
          {selected.length > 0 && (
            <div onClick={() => onChange([])} style={{ padding: '6px 10px', fontSize: 12, color: '#ef4444', cursor: 'pointer', borderBottom: '1px solid var(--border, #e5e7eb)', fontWeight: 600 }}>
              <i className="fa-solid fa-xmark" style={{ marginRight: 4 }} />Limpiar
            </div>
          )}
          {options.map(opt => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer', background: selected.includes(opt) ? '#eff6ff' : 'transparent' }}>
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} style={{ accentColor: '#3b82f6' }} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────
function Sidebar({ dbStatus, setDbStatus, onDataLoaded, activeTab, setActiveTab, empresa }) {
  const [dbLoading, setDbLoading] = useState(false);
  const [dbProgress, setDbProgress] = useState(null);

  const [fecha, setFecha] = useState('');
  const [empresaLocal, setEmpresaLocal] = useState('');
  const [denomLocal, setDenomLocal] = useState('');
  const [empresas, setEmpresas] = useState([]);
  const [denominaciones, setDenominaciones] = useState([]);
  const [fechasDisp, setFechasDisp] = useState([]);

  const autoLoaded = useRef(false);

  const filtersLoaded = useRef(false);
  useEffect(() => {
    if (filtersLoaded.current) return;
    filtersLoaded.current = true;
    api('/api/db/filters').then(d => {
      setEmpresas(d.empresas || []);
      setFechasDisp(d.fechas || []);
      if (d.fechas?.length) setFecha(prev => prev || d.fechas[0]);
      return d;
    }).catch(() => {});
    api('/api/db/denominaciones').then(d => setDenominaciones(d.denominaciones || [])).catch(() => {});
  }, []);

  const loadFromDB = async (overrides = {}) => {
    const f = overrides.fecha ?? fecha;
    const emp = overrides.empresa ?? empresaLocal;
    const den = overrides.denominacion ?? denomLocal;
    setDbLoading(true);
    setDbProgress({ step: 'Conectando...', pct: 0 });
    try {
      await api('/api/db/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: SESSION_ID, fecha: f, empresa: emp, denominacion: den }),
      });
      const poll = setInterval(async () => {
        try {
          const p = await api(`/api/db/progress?session_id=${SESSION_ID}`);
          setDbProgress({ step: p.step, pct: p.pct });
          if (p.done) {
            clearInterval(poll);
            setDbLoading(false);
            setDbProgress(null);
            const s = await api(`/api/db/status?session_id=${SESSION_ID}`);
            setDbStatus(s);
            if (s.viajes_loaded && s.asistencia_loaded) onDataLoaded(s);
            if (p.errors?.length) alert('Errores BD: ' + p.errors.join('\n'));
          }
        } catch {}
      }, 1500);
    } catch (e) {
      alert('Error conectando BD: ' + e.message);
      setDbLoading(false);
      setDbProgress(null);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon"><i className="fa-solid fa-bus" /></div>
        <div>
          <h2>TRANSPORTE</h2>
          <div className="brand-sub">Cosecha</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button className={`sidebar-nav-item ${activeTab === 'cosecha' ? 'active' : ''}`} onClick={() => setActiveTab('cosecha')}>
          <span className="nav-icon"><i className="fa-solid fa-wheat-awn" /></span> Cosecha
        </button>
        <button className={`sidebar-nav-item ${activeTab === 'transporte' ? 'active' : ''}`} onClick={() => setActiveTab('transporte')}>
          <span className="nav-icon"><i className="fa-solid fa-truck" /></span> Transporte
        </button>
        <button className={`sidebar-nav-item ${activeTab === 'indicadores' ? 'active' : ''}`} onClick={() => setActiveTab('indicadores')}>
          <span className="nav-icon"><i className="fa-solid fa-chart-line" /></span> Indicadores
        </button>
        <button className={`sidebar-nav-item ${activeTab === 'bajas' ? 'active' : ''}`} onClick={() => setActiveTab('bajas')}>
          <span className="nav-icon"><i className="fa-solid fa-user-minus" /></span> Bajas
        </button>
      </nav>

      <div className="sidebar-section">
        <span className="sidebar-section-title">Filtros</span>
        <label style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, display: 'block' }}>Fecha</label>
        {fechasDisp.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
            {fechasDisp.map(f => {
              const d = new Date(f + 'T12:00:00');
              const dayName = d.toLocaleDateString('es-PE', { weekday: 'short' });
              const dayNum = d.getDate();
              const monthName = d.toLocaleDateString('es-PE', { month: 'short' });
              const isSelected = fecha === f;
              return (
                <button key={f} onClick={() => { setFecha(f); }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, border: isSelected ? '1.5px solid #3b82f6' : '1px solid transparent', background: isSelected ? '#3b82f620' : 'rgba(255,255,255,0.05)', color: isSelected ? '#60a5fa' : 'var(--sidebar-text, #cbd5e1)', cursor: 'pointer', transition: 'all .15s', fontSize: 12, textAlign: 'left' }}>
                  <span style={{ fontWeight: 700, fontSize: 16, minWidth: 24, textAlign: 'center' }}>{dayNum}</span>
                  <span style={{ textTransform: 'capitalize', fontSize: 11, opacity: 0.7 }}>{dayName}, {monthName}</span>
                  {isSelected && <i className="fa-solid fa-check" style={{ marginLeft: 'auto', fontSize: 10 }} />}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--sidebar-text-dim)', marginBottom: 10 }}>Cargando fechas...</div>
        )}
        <label>Empresa</label>
        <select value={empresaLocal} onChange={e => {
          setEmpresaLocal(e.target.value);
          setDenomLocal('');
          api(`/api/db/denominaciones?empresa=${encodeURIComponent(e.target.value)}`).then(d => setDenominaciones(d.denominaciones || [])).catch(() => {});
        }} style={{ width: '100%', marginBottom: 12 }}>
          <option value="">Todas</option>
          {empresas.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <label>Denominación CECO</label>
        <select value={denomLocal} onChange={e => setDenomLocal(e.target.value)} style={{ width: '100%', marginBottom: 12 }}>
          <option value="">Todas</option>
          {denominaciones.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button onClick={() => loadFromDB()} disabled={dbLoading} className="btn-buscar">
          {dbLoading ? <><span className="spinner" /> Cargando...</> : 'Buscar'}
        </button>
        {dbProgress && (
          <div className="sp-progress" style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--sidebar-text-dim)' }}>
              <span className="spinner" /> {dbProgress.step}
            </div>
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${dbProgress.pct}%` }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--sidebar-text-dim)', textAlign: 'right' }}>{dbProgress.pct}%</div>
          </div>
        )}
      </div>

      <div className="datos-generales">
        <span className="sidebar-section-title">Datos Generales</span>
        {dbStatus ? (
          <>
            <div className="datos-item"><span className="datos-icon"><i className="fa-solid fa-clipboard-list" /></span> Jornada: <strong>{formatNum(dbStatus.jarras_count)}</strong></div>
            <div className="datos-item"><span className="datos-icon"><i className="fa-solid fa-rotate" /></span> Actualizado: <strong>{formatNum(dbStatus.actividad_count)}</strong></div>
            {dbStatus.asistencia_loaded && (
              <div className="datos-item"><span className="datos-icon"><i className="fa-solid fa-users" /></span> Asistencia: <strong>{formatNum(dbStatus.asistencia_count)}</strong></div>
            )}
            {dbStatus.viajes_loaded && (
              <div className="datos-item"><span className="datos-icon"><i className="fa-solid fa-chair" /></span> Vacíos: <strong>{formatNum(dbStatus.viajes_count)} buses</strong></div>
            )}
            <div className="online-badge"><span className="online-dot" /> En línea</div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--sidebar-text-dim)', padding: '8px 0' }}>Sin datos cargados</div>
        )}
      </div>
    </aside>
  );
}

// ─── Dropzone ──────────────────────────────────────────────────────────────
function Dropzone({ icon, label, hint, multiple, onFiles, fileNames }) {
  const inputRef = useRef();
  const [dragOver, setDragOver] = useState(false);
  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); onFiles(Array.from(e.dataTransfer.files)); };
  return (
    <div className={`dropzone ${dragOver ? 'drag-over' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current.click()}>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" multiple={multiple}
        style={{ display: 'none' }} onChange={e => onFiles(Array.from(e.target.files))} />
      <div className="dropzone-icon">{icon}</div>
      <div className="dropzone-label">{label}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{hint}</div>}
      {fileNames.length > 0 && (
        <div className="dropzone-files">{fileNames.map((n, i) => <span key={i} className="badge">{n}</span>)}</div>
      )}
    </div>
  );
}

// ─── Metric Card ───────────────────────────────────────────────────────────
function MetricCard({ title, value, color, icon }) {
  return (
    <div className="metric-card" data-color={color}>
      <div className="metric-card-inner">
        {icon && <div className="metric-icon">{icon}</div>}
        <div>
          <div className="metric-value">{formatNum(value)}</div>
          <div className="metric-title">{title}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Fix Leaflet default icons ────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const ZONE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#ea580c', '#9333ea', '#0891b2', '#ca8a04', '#e11d48', '#4f46e5', '#059669'];

function makeIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

const plantaIcon = L.divIcon({
  className: '',
  html: `<div style="background:#b91c1c;width:20px;height:20px;border-radius:4px;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center"><span style="color:#fff;font-size:11px;font-weight:700">P</span></div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

// ─── MapController (fly to a zone) ────────────────────────────────────────
function MapController({ flyTo }) {
  const map = useMap();
  useEffect(() => {
    if (flyTo) map.flyTo([flyTo.lat, flyTo.lng], 13, { duration: 1 });
  }, [flyTo, map]);
  return null;
}

// ─── OSRMRoute (real road route) ──────────────────────────────────────────
const osrmCache = {};
const osrmQueue = [];
let osrmRunning = false;

async function fetchOSRMRoute(from, to) {
  const cacheKey = `${from[0].toFixed(4)},${from[1].toFixed(4)}-${to[0].toFixed(4)},${to[1].toFixed(4)}`;
  if (osrmCache[cacheKey]) return osrmCache[cacheKey];

  return new Promise((resolve) => {
    osrmQueue.push({ from, to, cacheKey, resolve });
    if (!osrmRunning) processOSRMQueue();
  });
}

async function processOSRMQueue() {
  osrmRunning = true;
  while (osrmQueue.length > 0) {
    const { from, to, cacheKey, resolve } = osrmQueue.shift();
    if (osrmCache[cacheKey]) { resolve(osrmCache[cacheKey]); continue; }
    try {
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`
      );
      const data = await res.json();
      if (data.code === 'Ok' && data.routes?.[0]) {
        const coords = data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const distance = data.routes[0].distance;
        const duration = data.routes[0].duration;
        osrmCache[cacheKey] = { coords, distance, duration };
        resolve(osrmCache[cacheKey]);
      } else {
        resolve({ coords: [[from[0], from[1]], [to[0], to[1]]], distance: 0, duration: 0 });
      }
    } catch {
      resolve({ coords: [[from[0], from[1]], [to[0], to[1]]], distance: 0, duration: 0 });
    }
    await new Promise(r => setTimeout(r, 200));
  }
  osrmRunning = false;
}

function OSRMRoute({ from, to, color, weight, opacity, dashArray }) {
  const [routeData, setRouteData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchOSRMRoute(from, to).then(data => {
      if (!cancelled) setRouteData(data);
    });
    return () => { cancelled = true; };
  }, [from[0], from[1], to[0], to[1]]);

  if (!routeData) return null;
  return (
    <>
      <Polyline positions={routeData.coords} pathOptions={{ color, weight, opacity, dashArray }} />
      {routeData.distance > 0 && (
        <Marker
          position={routeData.coords[Math.floor(routeData.coords.length / 2)]}
          icon={L.divIcon({
            className: '',
            html: `<div style="background:#fff;padding:1px 5px;border-radius:4px;font-size:10px;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.3);white-space:nowrap;color:#333">${(routeData.distance / 1000).toFixed(1)} km</div>`,
            iconSize: [60, 16],
            iconAnchor: [30, 8],
          })}
        />
      )}
    </>
  );
}

// ─── RouteMap ─────────────────────────────────────────────────────────────
function RouteMap({ rutasData, onDistancesReady }) {
  if (!rutasData || !rutasData.rutas?.length) return null;

  const destinos = rutasData.destinos || {};
  const rutas = rutasData.rutas || [];

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPlaca, setSelectedPlaca] = useState('');
  const [flyTo, setFlyTo] = useState(null);
  const [paraderos, setParaderos] = useState({});

  useEffect(() => {
    fetch(`/api/paraderos`).then(r => r.json()).then(setParaderos).catch(() => {});
  }, []);

  // Calculate distances
  useEffect(() => {
    if (!onDistancesReady) return;
    let cancelled = false;
    (async () => {
      const distances = {};
      const seen = new Set();
      for (const r of rutas) {
        if (cancelled) break;
        if (!r.origen_coords) continue;
        const key = `${r.origen}->${r.destino}`;
        if (seen.has(key)) {
          if (distances[r.origen]) distances[r.origen].buses.push({ placa: r.placa, capacidad: r.capacidad, pasajeros: r.pasajeros, ocupacion: r.ocupacion });
          continue;
        }
        seen.add(key);
        const dest = destinos[r.destino];
        if (!dest) continue;
        const data = await fetchOSRMRoute([r.origen_coords.lat, r.origen_coords.lng], [dest.lat, dest.lng]);
        distances[r.origen] = {
          destino: r.destino,
          distancia_km: +(data.distance / 1000).toFixed(1),
          duracion_min: +(data.duration / 60).toFixed(0),
          buses: [{ placa: r.placa, capacidad: r.capacidad, pasajeros: r.pasajeros, ocupacion: r.ocupacion }],
        };
      }
      if (!cancelled) onDistancesReady(distances);
    })();
    return () => { cancelled = true; };
  }, [rutas]);

  const allPoints = [];
  Object.values(destinos).forEach(d => allPoints.push([d.lat, d.lng]));
  rutas.forEach(r => { if (r.origen_coords) allPoints.push([r.origen_coords.lat, r.origen_coords.lng]); });

  if (allPoints.length < 2) {
    return (
      <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 13 }}>
        <span className="spinner" style={{ marginRight: 8 }} />
        Cargando rutas...
      </div>
    );
  }

  const center = [
    allPoints.reduce((s, p) => s + p[0], 0) / allPoints.length,
    allPoints.reduce((s, p) => s + p[1], 0) / allPoints.length,
  ];

  // Assign colors per placa
  const placaColors = {};
  rutas.forEach((r, i) => { placaColors[r.placa] = ZONE_COLORS[i % ZONE_COLORS.length]; });

  const filteredRutas = rutas.filter(r => {
    if (selectedPlaca) return r.placa === selectedPlaca;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return r.placa.toLowerCase().includes(s) || r.origen.toLowerCase().includes(s) || r.ruta.toLowerCase().includes(s);
    }
    return true;
  });

  const handlePlacaClick = (placa) => {
    if (selectedPlaca === placa) {
      setSelectedPlaca('');
      setFlyTo(null);
    } else {
      setSelectedPlaca(placa);
      const r = rutas.find(x => x.placa === placa);
      if (r?.origen_coords) setFlyTo({ ...r.origen_coords, _t: Date.now() });
    }
  };

  const handleFlyToPlanta = (key) => {
    const d = destinos[key];
    if (d) setFlyTo({ lat: d.lat, lng: d.lng, _t: Date.now() });
    setSelectedPlaca('');
  };

  const clearFilter = () => {
    setSearchTerm('');
    setSelectedPlaca('');
    setFlyTo(null);
  };

  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ marginBottom: 8 }}><i className="fa-solid fa-map-location-dot" style={{ marginRight: 6 }} />Mapa de Rutas por Placa</h3>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 350 }}>
          <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', fontSize: 13 }} />
          <input
            type="text"
            placeholder="Buscar placa o zona..."
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setSelectedPlaca(''); }}
            style={{ width: '100%', paddingLeft: 32, height: 36, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card, #fff)', fontSize: 13 }}
          />
          {(searchTerm || selectedPlaca) && (
            <button onClick={clearFilter} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 16 }}>✕</button>
          )}
        </div>
        <select value={selectedPlaca} onChange={e => { setSelectedPlaca(e.target.value); setSearchTerm(''); const r = rutas.find(x => x.placa === e.target.value); if (r?.origen_coords) setFlyTo({ ...r.origen_coords, _t: Date.now() }); }} style={{ height: 36, borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, minWidth: 180 }}>
          <option value="">Todas las placas ({rutas.length})</option>
          {rutas.map(r => (
            <option key={r.placa} value={r.placa}>{r.placa} — {r.ruta}</option>
          ))}
        </select>
        {Object.keys(destinos).map(key => (
          <button key={key} onClick={() => handleFlyToPlanta(key)} className="btn btn-sm" style={{ height: 36, fontSize: 12 }}>
            <i className="fa-solid fa-location-dot" style={{ marginRight: 4 }} />{key}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {filteredRutas.map(r => {
          const color = placaColors[r.placa];
          const sel = selectedPlaca === r.placa;
          return (
            <span key={r.placa} onClick={() => handlePlacaClick(r.placa)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '3px 10px', borderRadius: 12, background: sel ? color + '30' : color + '12', border: `1.5px solid ${sel ? color : color + '40'}`, cursor: 'pointer', transition: 'all .15s' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
              {r.placa} ({r.origen} → {r.destino}) {r.pasajeros}/{r.capacidad}
              <span style={{ color: r.ocupacion >= 80 ? '#16a34a' : r.ocupacion >= 50 ? '#ca8a04' : '#dc2626', fontWeight: 600, marginLeft: 4 }}>{r.ocupacion}%</span>
            </span>
          );
        })}
      </div>

      <div style={{ height: 650, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <MapContainer center={center} zoom={9} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <MapController flyTo={flyTo} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {Object.entries(destinos).map(([key, d]) => (
            <Marker key={key} position={[d.lat, d.lng]} icon={plantaIcon}>
              <Popup><strong>{key}</strong><br />{d.nombre}</Popup>
              <Tooltip permanent direction="top" offset={[0, -12]}>
                <span style={{ fontWeight: 700, fontSize: 11 }}>{key}</span>
              </Tooltip>
            </Marker>
          ))}
          {filteredRutas.map(r => {
            if (!r.origen_coords) return null;
            const dest = destinos[r.destino];
            if (!dest) return null;
            const color = placaColors[r.placa];
            const sel = selectedPlaca === r.placa;
            const origenKey = r.origen.toUpperCase().trim();
            return (
              <React.Fragment key={r.placa}>
                <Marker position={[r.origen_coords.lat, r.origen_coords.lng]} icon={makeIcon(color)}>
                  <Popup>
                    <strong>{r.placa}</strong><br />
                    {r.ruta}<br />
                    <span style={{ fontSize: 11 }}>
                      Cap: {r.capacidad} | Pas: {r.pasajeros} | Ocup: <b style={{ color: r.ocupacion >= 80 ? '#16a34a' : r.ocupacion >= 50 ? '#ca8a04' : '#dc2626' }}>{r.ocupacion}%</b><br />
                      Tarifa: S/{r.tarifa?.toLocaleString()} | Tipo: {r.tipo_bus}
                    </span>
                  </Popup>
                  <Tooltip direction="bottom" offset={[0, 6]}>
                    <span style={{ fontSize: 10 }}>{r.placa}</span>
                  </Tooltip>
                </Marker>
                <OSRMRoute
                  from={[r.origen_coords.lat, r.origen_coords.lng]}
                  to={[dest.lat, dest.lng]}
                  color={color}
                  weight={sel ? 4 : 2.5}
                  opacity={sel ? 1 : 0.7}
                  dashArray={sel ? '' : '6 4'}
                />
                {sel && (paraderos[origenKey] || paraderos[r.origen])?.paradas?.map((p, pi) => (
                  <CircleMarker key={`${r.placa}-p-${pi}`} center={[p.lat, p.lng]} radius={7} pathOptions={{ color: '#fff', fillColor: color, fillOpacity: 0.9, weight: 2 }}>
                    <Tooltip direction="top" offset={[0, -6]}>
                      <span style={{ fontSize: 11 }}><b>{p.nombre}</b><br />{r.origen}</span>
                    </Tooltip>
                    <Popup><b>{p.nombre}</b><br />Parada en {r.origen}</Popup>
                  </CircleMarker>
                ))}
              </React.Fragment>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}

// ─── FuelEstimator ────────────────────────────────────────────────────────
function FuelEstimator({ routeDistances, cruce, facilito }) {
  const [tipoBus, setTipoBus] = useState(0);
  const [tipoCombustible, setTipoCombustible] = useState(0);

  if (!routeDistances || !cruce?.length) return null;

  const bus = TIPOS_BUS[tipoBus];
  const comb = TIPOS_COMBUSTIBLE[tipoCombustible];
  const rendimientoReal = bus.rendimiento * comb.rendimientoFactor;

  const precioGalon = useMemo(() => {
    if (!facilito?.length) return null;
    const registros = facilito.filter(r => r.producto === comb.key && r.precio);
    if (!registros.length) return null;
    const precios = registros.map(r => parseFloat(r.precio)).filter(p => !isNaN(p) && p > 0);
    if (!precios.length) return null;
    return +(precios.reduce((a, b) => a + b, 0) / precios.length).toFixed(2);
  }, [facilito, comb.key]);

  const rows = !precioGalon ? [] : cruce.map(r => {
    const cap = r.CAPACIDAD || 0;
    if (cap < bus.capMin || cap > bus.capMax) return null;
    const zona = r.ZONA_PROCEDENCIA || '';
    const dist = routeDistances[zona];
    if (!dist) return null;
    const distKm = dist.distancia_km;
    const galones = distKm / rendimientoReal;
    const costoCombustible = galones * precioGalon;
    const costoPeaje = PEAJES_POR_ZONA[zona.toUpperCase()] || 0;
    const costoMantenimiento = distKm * bus.mantKm;
    const costoDepreciacion = distKm * bus.deprecKm;
    const costoTotal = costoCombustible + costoPeaje + costoMantenimiento + costoDepreciacion + bus.chofer + bus.seguro;
    const tarifa = r.TARIFA || 0;
    const diferencia = tarifa - costoTotal;
    const pctDif = costoTotal > 0 ? ((tarifa - costoTotal) / costoTotal * 100) : 0;
    return {
      placa: r.BUS,
      zona,
      destino: dist.destino,
      distKm,
      costoCombustible: +costoCombustible.toFixed(2),
      costoPeaje: +costoPeaje.toFixed(2),
      costoMantenimiento: +costoMantenimiento.toFixed(2),
      costoDepreciacion: +costoDepreciacion.toFixed(2),
      costoChofer: bus.chofer,
      costoSeguro: bus.seguro,
      costoTotal: +costoTotal.toFixed(2),
      tarifa: +tarifa.toFixed(2),
      diferencia: +diferencia.toFixed(2),
      pctDif: +pctDif.toFixed(1),
    };
  }).filter(Boolean);

  const totales = rows.reduce((acc, r) => ({
    combustible: acc.combustible + r.costoCombustible,
    peaje: acc.peaje + r.costoPeaje,
    mantenimiento: acc.mantenimiento + r.costoMantenimiento,
    depreciacion: acc.depreciacion + r.costoDepreciacion,
    chofer: acc.chofer + r.costoChofer,
    seguro: acc.seguro + r.costoSeguro,
    costoTotal: acc.costoTotal + r.costoTotal,
    tarifa: acc.tarifa + r.tarifa,
  }), { combustible: 0, peaje: 0, mantenimiento: 0, depreciacion: 0, chofer: 0, seguro: 0, costoTotal: 0, tarifa: 0 });

  const sobrepagoTotal = totales.tarifa - totales.costoTotal;

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ marginBottom: 12 }}><i className="fa-solid fa-calculator" style={{ marginRight: 6 }} />Costo Operativo por Bus — Sustento de tarifa</h3>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12, padding: 16, background: 'var(--bg-card, #f9fafb)', borderRadius: 10, border: '1px solid var(--border)' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Tipo de Bus</label>
          <select value={tipoBus} onChange={e => setTipoBus(+e.target.value)} style={{ width: '100%', height: 36, borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }}>
            {TIPOS_BUS.map((t, i) => <option key={i} value={i}>{t.label} — {t.rendimiento} km/gal</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 160px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Combustible</label>
          <select value={tipoCombustible} onChange={e => setTipoCombustible(+e.target.value)} style={{ width: '100%', height: 36, borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }}>
            {TIPOS_COMBUSTIBLE.map((t, i) => <option key={i} value={i}>{t.label}</option>)}
          </select>
        </div>
        <div style={{ flex: '0 0 130px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Precio/Galón</label>
          {precioGalon ? (
            <div style={{ height: 36, display: 'flex', alignItems: 'center', fontSize: 16, fontWeight: 700, color: '#059669' }}>
              S/{precioGalon} <span style={{ fontSize: 10, fontWeight: 400, color: '#6b7280', marginLeft: 4 }}>Facilito</span>
            </div>
          ) : (
            <div style={{ height: 36, display: 'flex', alignItems: 'center', fontSize: 11, color: '#dc2626' }}>
              Sin datos — scrapea Facilito
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, padding: 12, background: '#f0f9ff', borderRadius: 10, border: '1px solid #0ea5e920', fontSize: 11, color: '#0c4a6e' }}>
        <div><b>Costos fijos ({bus.label}):</b></div>
        <div>Mant: S/{bus.mantKm}/km</div>
        <div>Deprec: S/{bus.deprecKm}/km</div>
        <div>Chofer: S/{bus.chofer}/viaje</div>
        <div>Seguro: S/{bus.seguro}/viaje</div>
      </div>

      {!precioGalon && (
        <div style={{ padding: 24, textAlign: 'center', background: '#fef2f2', borderRadius: 10, border: '1px solid #fecaca', color: '#991b1b' }}>
          <i className="fa-solid fa-gas-pump" style={{ fontSize: 24, marginBottom: 8, display: 'block' }} />
          <b>Scrapea precios de Facilito primero</b>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#b91c1c' }}>Usa el botón "Consultar Facilito" arriba para obtener precios de combustible actualizados.</p>
        </div>
      )}

      {precioGalon && <><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 16 }}>
        <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-card, #fff)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>S/{totales.combustible.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Combustible</div>
        </div>
        <div style={{ padding: 10, borderRadius: 8, background: '#fef3c7', border: '1px solid #f59e0b40' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#92400e' }}>S/{totales.peaje.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 10, color: '#92400e' }}>Peajes</div>
        </div>
        <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-card, #fff)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>S/{totales.mantenimiento.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Mantenimiento</div>
        </div>
        <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-card, #fff)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>S/{totales.depreciacion.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Depreciación</div>
        </div>
        <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-card, #fff)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>S/{totales.chofer.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Chofer</div>
        </div>
        <div style={{ padding: 10, borderRadius: 8, background: '#dbeafe', border: '1px solid #3b82f640' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1d4ed8' }}>S/{totales.costoTotal.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 10, color: '#1e40af' }}>Costo operativo total</div>
        </div>
        <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-card, #fff)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>S/{totales.tarifa.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Tarifa cobrada</div>
        </div>
        <div style={{ padding: 10, borderRadius: 8, background: sobrepagoTotal > 0 ? '#fef2f2' : '#f0fdf4', border: `1px solid ${sobrepagoTotal > 0 ? '#ef444440' : '#22c55e40'}` }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: sobrepagoTotal > 0 ? 'var(--red)' : 'var(--green)' }}>
            {sobrepagoTotal > 0 ? '+' : ''}S/{sobrepagoTotal.toLocaleString('es-PE', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 10, color: sobrepagoTotal > 0 ? '#991b1b' : '#166534' }}>
            {sobrepagoTotal > 0 ? 'Sobrepago' : 'Ahorro'} vs costo operativo
          </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="mini-table" style={{ width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th>Bus</th>
              <th>Zona</th>
              <th>Destino</th>
              <th style={{ textAlign: 'right' }}>Dist (km)</th>
              <th style={{ textAlign: 'right' }}>Combust.</th>
              <th style={{ textAlign: 'right' }}>Peaje</th>
              <th style={{ textAlign: 'right' }}>Mant.</th>
              <th style={{ textAlign: 'right' }}>Deprec.</th>
              <th style={{ textAlign: 'right' }}>Chofer</th>
              <th style={{ textAlign: 'right', color: '#1d4ed8', fontWeight: 700 }}>Costo Op.</th>
              <th style={{ textAlign: 'right' }}>Tarifa</th>
              <th style={{ textAlign: 'right' }}>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {rows.sort((a, b) => b.diferencia - a.diferencia).map(r => (
              <tr key={r.placa}>
                <td style={{ fontFamily: 'var(--mono)' }}>{r.placa}</td>
                <td>{r.zona}</td>
                <td>{r.destino}</td>
                <td style={{ textAlign: 'right' }}>{r.distKm.toFixed(1)}</td>
                <td style={{ textAlign: 'right' }}>S/{r.costoCombustible.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                <td style={{ textAlign: 'right', color: '#92400e' }}>S/{r.costoPeaje.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                <td style={{ textAlign: 'right' }}>S/{r.costoMantenimiento.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                <td style={{ textAlign: 'right' }}>S/{r.costoDepreciacion.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                <td style={{ textAlign: 'right' }}>S/{r.costoChofer.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: '#1d4ed8' }}>S/{r.costoTotal.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                <td style={{ textAlign: 'right' }}>S/{r.tarifa.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: r.diferencia > 0 ? 'var(--red)' : 'var(--green)' }}>
                  {r.diferencia > 0 ? (
                    <><i className="fa-solid fa-arrow-up" style={{ fontSize: 10, marginRight: 3 }} />S/{r.diferencia.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</>
                  ) : (
                    <><i className="fa-solid fa-arrow-down" style={{ fontSize: 10, marginRight: 3 }} />S/{Math.abs(r.diferencia).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</>
                  )}
                  <span style={{ fontSize: 10, opacity: 0.7 }}> ({r.pctDif > 0 ? '+' : ''}{r.pctDif}%)</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [dbStatus, setDbStatus] = useState(null);
  const [activeTab, setActiveTab] = useState('cosecha');
  const [viajesFiles, setViajesFiles] = useState([]);
  const [asistenciaFile, setAsistenciaFile] = useState(null);
  const [viajesUploaded, setViajesUploaded] = useState(false);
  const [asistenciaUploaded, setAsistenciaUploaded] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [cruce, setCruce] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [filters, setFilters] = useState({ cecos: [], zonas: [], placas: [] });
  const [selCeco, setSelCeco] = useState([]);
  const [selZona, setSelZona] = useState([]);
  const [selPlaca, setSelPlaca] = useState([]);
  const [searchPlaca, setSearchPlaca] = useState('');
  const [detailPlaca, setDetailPlaca] = useState('');
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [umbral, setUmbral] = useState(70);
  const [rebalanceo, setRebalanceo] = useState(null);
  const [rebalLoading, setRebalLoading] = useState(false);
  const [rebalOpen, setRebalOpen] = useState({});
  const [selectedBuses, setSelectedBuses] = useState(new Set());
  const [ejecutados, setEjecutados] = useState({});
  const [busesEjecutados, setBusesEjecutados] = useState(new Set());
  const [busesDT, setBusesDT] = useState(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const gridRef = useRef(null);
  const [busesProgramados, setBusesProgramados] = useState(new Set());
  const [unificaciones, setUnificaciones] = useState([]);
  const [showUnificarModal, setShowUnificarModal] = useState(false);
  const [unificarPlaca, setUnificarPlaca] = useState('');
  const [ahorrosSemanal, setAhorrosSemanal] = useState(null);
  const [semanasSeleccionadas, setSemanasSeleccionadas] = useState([]);
  const [ahorrosLoading, setAhorrosLoading] = useState(false);
  const [showSemanasDropdown, setShowSemanasDropdown] = useState(false);
  const [rutasData, setRutasData] = useState(null);
  const [routeDistances, setRouteDistances] = useState(null);

  const [expandedSector, setExpandedSector] = useState(null);

  const [novedadesUploading, setNovedadesUploading] = useState(false);
  const [novedadesMsg, setNovedadesMsg] = useState('');
  const [novedades, setNovedades] = useState([]);
  const [novedadForm, setNovedadForm] = useState({ fecha: '', zona: '', dni: '', nombre: '', motivo: '', tipo: 'contar' });

  const [comparativa, setComparativa] = useState(null);
  const [comparativaLoading, setComparativaLoading] = useState(false);
  const [comparativaFecha, setComparativaFecha] = useState('');

  const [compEjec, setCompEjec] = useState(null);
  const [compEjecLoading, setCompEjecLoading] = useState(false);

  const [kilosExport, setKilosExport] = useState(null);
  const tipoCambio = 3.36;

  const [intercambios, setIntercambios] = useState([]);
  const [rebajas, setRebajas] = useState([]);
  const [showIntercambioModal, setShowIntercambioModal] = useState(false);
  const [showDTModal, setShowDTModal] = useState(false);
  const [dtDias, setDtDias] = useState(1);
  const [intercambioPlacaOriginal, setIntercambioPlacaOriginal] = useState('');
  const [intercambioPlacaNueva, setIntercambioPlacaNueva] = useState('');

  const loadCompEjec = async () => {
    if (!dbStatus?.fecha) return;
    setCompEjecLoading(true);
    try {
      const res = await api('/api/comparativa/ejecucion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha: dbStatus.fecha,
          buses: [],
          empresa: dbStatus.empresa || '',
          denominacion: dbStatus.denominacion || '',
        }),
      });
      setCompEjec(res);
    } catch (e) { alert('Error: ' + e.message); }
    setCompEjecLoading(false);
  };

  const loadKilosExport = async (fechaOverride) => {
    const f = fechaOverride || dbStatus?.fecha;
    if (!f) return;
    try {
      const res = await api(`/api/kilos-exportacion?fecha=${encodeURIComponent(f)}&session_id=${SESSION_ID}`);
      setKilosExport(res);
    } catch (e) { console.error('kilos-export error', e); }
  };

  const loadComparativa = async (fecha = '') => {
    setComparativaLoading(true);
    try {
      const emp = dbStatus?.empresa || '';
      const den = dbStatus?.denominacion || '';
      const params = new URLSearchParams();
      if (fecha) params.set('fecha', fecha);
      if (emp) params.set('empresa', emp);
      if (den) params.set('denominacion', den);
      const data = await api(`/api/comparativa?${params}`);
      setComparativa(data);
      if (!fecha && data.hoy?.fecha) setComparativaFecha(data.hoy.fecha);
    } catch (e) { console.error('Error comparativa:', e); }
    setComparativaLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'comparativa' && !comparativa) loadComparativa(comparativaFecha);
  }, [activeTab]);


  const uploadNovedadesMasivo = async (file) => {
    setNovedadesUploading(true);
    setNovedadesMsg('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/novedades/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Error');
      setNovedadesMsg(`${data.inserted} novedades cargadas de ${data.filename}`);
      loadNovedades(novedadForm.fecha);
    } catch (e) { setNovedadesMsg('Error: ' + e.message); }
    setNovedadesUploading(false);
  };

  const loadNovedades = async (fecha) => {
    try {
      const params = fecha ? `?fecha=${fecha}` : '';
      const res = await api(`/api/novedades${params}`);
      setNovedades(res.rows || []);
    } catch (e) { console.error(e); }
  };
  const guardarNovedad = async () => {
    if (!novedadForm.fecha || !novedadForm.dni) return alert('Fecha y DNI son requeridos');
    try {
      await api('/api/novedades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novedadForm) });
      setNovedadForm({ fecha: novedadForm.fecha, zona: '', dni: '', nombre: '', motivo: '', tipo: 'contar' });
      loadNovedades(novedadForm.fecha);
    } catch (e) { alert('Error: ' + e.message); }
  };
  const eliminarNovedad = async (id) => {
    try {
      await api(`/api/novedades/${id}`, { method: 'DELETE' });
      loadNovedades(novedadForm.fecha);
    } catch (e) { alert('Error: ' + e.message); }
  };
  const toggleNovedadTipo = async (nov) => {
    const nuevoTipo = nov.tipo === 'contar' ? 'no_contar' : 'contar';
    try {
      await api(`/api/novedades/${nov.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...nov, tipo: nuevoTipo }) });
      loadNovedades(novedadForm.fecha);
    } catch (e) { alert('Error: ' + e.message); }
  };

  const [indicadorMes, setIndicadorMes] = useState('');
  const [indicadorData, setIndicadorData] = useState(null);
  const [indicadorLoading, setIndicadorLoading] = useState(false);
  const [mesesDisponibles, setMesesDisponibles] = useState([]);

  const loadIndicadores = async (mes = '') => {
    setIndicadorLoading(true);
    try {
      const emp = dbStatus?.empresa || '';
      const den = dbStatus?.denominacion || '';
      const params = new URLSearchParams();
      if (mes) params.set('mes', mes);
      if (emp) params.set('empresa', emp);
      if (den) params.set('denominacion', den);
      const data = await api(`/api/indicadores/mensual?${params}`);
      setIndicadorData(data);
      setMesesDisponibles(data.meses_disponibles || []);
      if (!mes && data.mes) setIndicadorMes(data.mes);
    } catch (e) { console.error('Error indicadores:', e); }
    setIndicadorLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'indicadores' && !indicadorData) loadIndicadores(indicadorMes);
  }, [activeTab]);

  const [facilito, setFacilito] = useState([]);
  const [facilitoLoading, setFacilitoLoading] = useState(false);
  const [facilitoProgress, setFacilitoProgress] = useState(null);
  const [facilitoFilter, setFacilitoFilter] = useState({ dep: '', prov: '', prod: '' });

  const startFacilito = async () => {
    setFacilitoLoading(true);
    setFacilitoProgress({ step: 'Iniciando...', pct: 0 });
    try {
      await api('/api/facilito/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: SESSION_ID }),
      });
      const poll = setInterval(async () => {
        try {
          const p = await api(`/api/facilito/progress?session_id=${SESSION_ID}`);
          setFacilitoProgress({ step: p.step, pct: p.pct });
          if (p.done) {
            clearInterval(poll);
            const d = await api(`/api/facilito/data?session_id=${SESSION_ID}`);
            setFacilito(d.rows);
            setFacilitoLoading(false);
            setFacilitoProgress(null);
          }
        } catch {}
      }, 2000);
    } catch (e) {
      alert('Error: ' + e.message);
      setFacilitoLoading(false);
      setFacilitoProgress(null);
    }
  };

  const filteredFacilito = useMemo(() => {
    let d = facilito;
    if (facilitoFilter.dep) d = d.filter(r => r.departamento === facilitoFilter.dep);
    if (facilitoFilter.prov) d = d.filter(r => r.provincia === facilitoFilter.prov);
    if (facilitoFilter.prod) d = d.filter(r => r.producto === facilitoFilter.prod);
    return d;
  }, [facilito, facilitoFilter]);
  const facilitoDeps = useMemo(() => [...new Set(facilito.map(r => r.departamento))].sort(), [facilito]);
  const facilitoProvs = useMemo(() => {
    let d = facilito;
    if (facilitoFilter.dep) d = d.filter(r => r.departamento === facilitoFilter.dep);
    return [...new Set(d.map(r => r.provincia))].sort();
  }, [facilito, facilitoFilter.dep]);
  const facilitoProds = useMemo(() => [...new Set(facilito.map(r => r.producto))].sort(), [facilito]);
  const facilitoColumns = useMemo(() => [
    { field: 'departamento', headerName: 'Depto', width: 130 },
    { field: 'provincia', headerName: 'Provincia', width: 140 },
    { field: 'distrito', headerName: 'Distrito', width: 130 },
    { field: 'establecimiento', headerName: 'Establecimiento', flex: 1, minWidth: 200 },
    { field: 'direccion', headerName: 'Direccion', flex: 1, minWidth: 200 },
    { field: 'telefono', headerName: 'Telefono', width: 140 },
    { field: 'producto', headerName: 'Producto', width: 150 },
    { field: 'precio', headerName: 'Precio (S/)', width: 110, cellStyle: { fontWeight: 600, textAlign: 'right', fontFamily: 'var(--mono)' } },
  ], []);

  const dbReady = dbStatus?.jarras_loaded && dbStatus?.actividad_loaded;
  const asistFromDb = dbStatus?.asistencia_loaded;
  const viajesFromDb = dbStatus?.viajes_loaded;

  const uploadViajes = async (files) => {
    setViajesFiles(files);
    const fd = new FormData();
    fd.append('session_id', SESSION_ID);
    files.forEach(f => fd.append('files', f));
    try { await api('/api/upload/viajes', { method: 'POST', body: fd }); setViajesUploaded(true); }
    catch (e) { alert('Error subiendo viajes: ' + e.message); }
  };

  const uploadAsistencia = async (files) => {
    const file = files[0]; if (!file) return;
    setAsistenciaFile(file);
    const fd = new FormData();
    fd.append('session_id', SESSION_ID);
    fd.append('file', file);
    try { await api('/api/upload/asistencia', { method: 'POST', body: fd }); setAsistenciaUploaded(true); }
    catch (e) { alert('Error subiendo asistencia: ' + e.message); }
  };

  useEffect(() => {
    const asistOk = asistFromDb || asistenciaUploaded;
    const viajesOk = viajesFromDb || viajesUploaded;
    if (dbReady && viajesOk && asistOk && !processing && cruce.length === 0) runProcess();
  }, [dbReady, viajesUploaded, asistenciaUploaded, asistFromDb, viajesFromDb]);

  const runProcess = async (fechaParam) => {
    setProcessing(true);
    try {
      const res = await api('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: SESSION_ID }),
      });
      setCruce(res.cruce || []);
      setPersonas(res.personas || []);
      setMetrics(res.metrics || null);
      setFilters(res.filters || { cecos: [], zonas: [], placas: [] });
    } catch (e) { alert('Error procesando: ' + e.message); }
    setProcessing(false);
    loadKilosExport(fechaParam);
    setTimeout(() => loadUnificaciones(fechaParam), 100);
  };

  const filteredCruce = useMemo(() => {
    return cruce.filter(r => {
      if (selCeco.length > 0 && !selCeco.includes(r.CECO)) return false;
      if (selZona.length > 0 && !selZona.includes(r.ZONA_PROCEDENCIA)) return false;
      if (selPlaca.length > 0 && !selPlaca.includes(r.PLACA)) return false;
      if (searchPlaca && !(r.BUS || '').toUpperCase().includes(searchPlaca.toUpperCase())) return false;
      return true;
    });
  }, [cruce, selCeco, selZona, selPlaca, searchPlaca]);

  const filteredMetrics = useMemo(() => {
    if (!filteredCruce.length) return metrics;
    return {
      buses: filteredCruce.length,
      capacidad: filteredCruce.reduce((s, r) => s + (r.CAPACIDAD || 0), 0),
      pasajeros_reales: filteredCruce.reduce((s, r) => s + (r.PAS_REAL || 0), 0),
      asientos_vacios: filteredCruce.reduce((s, r) => s + (r.ASIENTOS_VACIOS || 0), 0),
      tarifa_total: filteredCruce.reduce((s, r) => s + (r.TARIFA || 0), 0),
    };
  }, [filteredCruce, metrics]);

  const detailPersons = useMemo(() => {
    if (!detailPlaca) return [];
    return personas.filter(p => p.PLACA === detailPlaca);
  }, [personas, detailPlaca]);

  const detailBusInfo = useMemo(() => {
    if (!detailPlaca) return null;
    return cruce.find(r => r.PLACA === detailPlaca) || null;
  }, [cruce, detailPlaca]);

  const cruceColumns = useMemo(() => {
    if (cruce.length === 0) return [];
    const hasCesados = cruce.some(r => r.PAS_CESADOS > 0);
    const visibleCols = ['BUS', 'T_BUS', 'PROVEEDOR','CAPACIDAD', 'RUTA', 'ZONA_PROCEDENCIA', 'TARIFA', 'PAS_REAL', ...(hasCesados ? ['PAS_CESADOS'] : []), 'PORCENTAJE_OCUP', 'ASIENTOS_VACIOS', 'COSTO_PASAJERO', 'KM', 'COSTO_KM', 'PERDIDA'];
    const headerNames = {'BUS':'Bus','T_BUS':'T. Bus','PROVEEDOR':'Proveedor','CAPACIDAD':'Cap.','RUTA':'Ruta','ZONA_PROCEDENCIA':'Zona','TARIFA':'Tarifa','PAS_REAL':'Pas. Real','PAS_CESADOS':'Cesados','PORCENTAJE_OCUP':'% Ocup.','ASIENTOS_VACIOS':'Vacío','COSTO_PASAJERO':'Costo/Pas','COSTO_KM':'S//Km','PERDIDA':'Pérdida'};
    const checkCol = {
      headerName: '',
      width: 50,
      maxWidth: 50,
      checkboxSelection: true,
      headerCheckboxSelection: true,
      sortable: false,
      filter: false,
      resizable: false,
      pinned: 'left',
    };
    const estadoCol = {
      headerName: 'Estado',
      width: 120,
      minWidth: 120,
      sortable: true,
      filter: true,
      resizable: false,
      valueGetter: params => {
        const bus = params.data?.BUS;
        if (busesEjecutados.has(bus)) return 'Ejecutado';
        if (busesDT.has(bus)) return 'DT';
        if (busesProgramados.has(bus)) return 'Sugerido';
        return '';
      },
      cellRenderer: params => {
        if (params.value === 'Ejecutado') return React.createElement('span', { style: { background: '#dcfce7', color: '#16a34a', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 } }, '✓ Ejecutado');
        if (params.value === 'DT') return React.createElement('span', { style: { background: '#e0e7ff', color: '#4338ca', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 } }, 'DT');
        if (params.value === 'Sugerido') return React.createElement('span', { style: { background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 } }, 'Sugerido');
        return null;
      },
    };
    const cols = [checkCol, estadoCol, ...visibleCols.filter(k => k === 'COSTO_KM' || cruce[0]?.[k] !== undefined).map(k => {
      if (k === 'KM') {
        return {
          field: 'KM',
          headerName: 'Km',
          sortable: true, filter: true, resizable: true,
          minWidth: 75, flex: 1,
          valueGetter: params => {
            const zona = (params.data?.ZONA_PROCEDENCIA || '').toUpperCase().trim();
            const dist = routeDistances?.[zona] || routeDistances?.[params.data?.ZONA_PROCEDENCIA];
            if (!dist || !dist.distancia_km) return null;
            return dist.distancia_km;
          },
          valueFormatter: params => params.value != null ? `${params.value.toFixed(1)}` : '—',
          cellStyle: { fontFamily: 'var(--mono)', textAlign: 'right' },
        };
      }
      if (k === 'COSTO_KM') {
        return {
          field: 'COSTO_KM',
          headerName: 'S//Km',
          sortable: true, filter: true, resizable: true,
          minWidth: 85, flex: 1,
          valueGetter: params => {
            const zona = (params.data?.ZONA_PROCEDENCIA || '').toUpperCase().trim();
            const dist = routeDistances?.[zona] || routeDistances?.[params.data?.ZONA_PROCEDENCIA];
            const tarifa = params.data?.TARIFA || 0;
            if (!dist || !dist.distancia_km || dist.distancia_km === 0) return null;
            return +(tarifa / dist.distancia_km).toFixed(2);
          },
          valueFormatter: params => params.value != null ? `S/${params.value.toFixed(2)}` : '—',
          cellStyle: { fontWeight: 600, fontFamily: 'var(--mono)', textAlign: 'right' },
        };
      }
      return {
        field: k,
        headerName: headerNames[k] || k.replace(/_/g, ' '),
        sortable: true, filter: true, resizable: true,
        minWidth: k === 'BUS' ? 100 : k === 'T_BUS' ? 90 : k === 'PROVEEDOR' ? 90 : k === 'CAPACIDAD' ? 70 : k === 'TARIFA' ? 80 : k === 'PAS_REAL' ? 80 : k === 'ASIENTOS_VACIOS' ? 80 : k === 'COSTO_PASAJERO' ? 80 : k === 'PERDIDA' ? 80 : k === 'RUTA' ? 180 : k === 'ZONA_PROCEDENCIA' ? 130 : 80,
        flex: k === 'RUTA' || k === 'ZONA_PROCEDENCIA' ? 2 : 1,
        valueFormatter: params => {
          if ((k === 'ASIENTOS_VACIOS' || k === 'PERDIDA') && params.value < 0) return 0;
          if (k === 'PORCENTAJE_OCUP') return params.value != null ? `${Math.round(params.value)}%` : '0%';
          return params.value;
        },
        cellStyle: params => {
          const val = (k === 'ASIENTOS_VACIOS' || k === 'PERDIDA') && params.value < 0 ? 0 : params.value;
          if (k === 'CAPACIDAD') return { color: 'var(--green)', fontWeight: 600 };
          if (k === 'ASIENTOS_VACIOS') {
            if (val > 10) return { color: 'var(--red)', fontWeight: 600 };
            return val > 0 ? { color: 'var(--red)' } : null;
          }
          if (k === 'PERDIDA') return val > 0 ? { color: 'var(--red)', fontWeight: 600 } : null;
          return null;
        },
      };
    })];
    return cols;
  }, [cruce, routeDistances, busesEjecutados, busesDT, busesProgramados]);

  const detailColumns = useMemo(() => [
    {
      headerName: 'Estado', width: 90, maxWidth: 90, sortable: true,
      valueGetter: p => p.data?.CESADO ? 'CESADO' : 'ACTIVO',
      cellRenderer: p => {
        const cesado = p.data?.CESADO;
        return React.createElement('span', {
          style: {
            background: cesado ? '#fef2f2' : '#f0fdf4',
            color: cesado ? '#dc2626' : '#16a34a',
            padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
          }
        }, cesado ? 'CESADO' : 'ACTIVO');
      },
    },
    { headerName: 'DNI', valueGetter: p => p.data?.['DNI PASA.'], sortable: true, filter: true, width: 120 },
    { field: 'PASAJERO', sortable: true, filter: true, flex: 1, minWidth: 200 },
    { field: 'cargo', headerName: 'Cargo', sortable: true, filter: true, width: 180 },
    { field: 'area', headerName: 'Área', sortable: true, filter: true, width: 160 },
    { field: 'ACTIVIDAD', sortable: true, filter: true, width: 140 },
    { field: 'GRUPO', headerName: 'Grupo', sortable: true, filter: true, width: 140 },
    {
      field: 'PROM_JARRAS_SEM', headerName: 'Jarras/Sem',
      sortable: true, filter: true, width: 130,
      cellStyle: params => {
        const v = parseFloat(params.value);
        if (v === 0) return { color: 'var(--text-dim)' };
        if (v >= 50) return { color: 'var(--green)', fontWeight: 600 };
        return null;
      },
    },
    {
      field: 'FECHA_CESE', headerName: 'F. Cese', width: 110, sortable: true,
      valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString('es-PE') : '',
      cellStyle: p => p.value ? { color: '#dc2626', fontWeight: 600 } : null,
    },
  ], []);

  const runRebalanceo = async () => {
    setRebalLoading(true);
    setEjecutados({});
    const f = dbStatus?.fecha || '';
    const emp = dbStatus?.empresa || '';
    const den = dbStatus?.denominacion || '';
    const buses_seleccionados = selectedBuses.size > 0 ? [...selectedBuses] : [];
    try {
      const [res, rutas] = await Promise.all([
        api('/api/rebalanceo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: SESSION_ID, umbral, fecha: f, empresa: emp, denominacion: den, buses_seleccionados }),
        }),
        api(`/api/rutas-mapa?session_id=${SESSION_ID}&fecha=${encodeURIComponent(f)}&empresa=${encodeURIComponent(emp)}&denominacion=${encodeURIComponent(den)}`),
      ]);
      setRebalanceo(res);
      setRutasData(rutas);
      const programados = new Set((res.recomendaciones || []).map(r => r.placa));
      setBusesProgramados(programados);
    } catch (e) { alert('Error en rebalanceo: ' + e.message); }
    setRebalLoading(false);
  };

  const guardarUnificacion = async (placaDestino) => {
    if (selectedBuses.size === 0 || !placaDestino) return;
    setActionLoading(true);
    const busesOrigen = [...selectedBuses];
    try {
      const res = await api('/api/unificaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha: dbStatus?.fecha || '',
          empresa: dbStatus?.empresa || '',
          denominacion: dbStatus?.denominacion || '',
          buses_origen: busesOrigen,
          placa_destino: placaDestino,
        }),
      });
      if (res.status === 'ok') {
        setUnificaciones(res.unificaciones || []);
        setBusesEjecutados(prev => {
          const next = new Set(prev);
          busesOrigen.forEach(b => next.add(b));
          return next;
        });
        setShowUnificarModal(false);
        setUnificarPlaca('');
        setSelectedBuses(new Set());
        gridRef.current?.api?.deselectAll();
      }
    } catch (e) { alert('Error: ' + e.message); } finally { setActionLoading(false); }
  };

  const darDeBaja = async () => {
    if (selectedBuses.size === 0) return;
    setActionLoading(true);
    const buses = [...selectedBuses];
    try {
      await api('/api/ejecutados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: SESSION_ID, buses, fecha: dbStatus?.fecha || '', empresa: dbStatus?.empresa || '', denominacion: dbStatus?.denominacion || '' }),
      });
      setBusesEjecutados(prev => {
        const next = new Set(prev);
        buses.forEach(b => next.add(b));
        return next;
      });
      setSelectedBuses(new Set());
        gridRef.current?.api?.deselectAll();
    } catch (e) { alert('Error: ' + e.message); } finally { setActionLoading(false); }
  };

  const darDT = () => {
    if (selectedBuses.size === 0) return;
    setDtDias(1);
    setShowDTModal(true);
  };

  const confirmarDT = async () => {
    setShowDTModal(false);
    setActionLoading(true);
    const buses = [...selectedBuses];
    try {
      await api('/api/dt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: SESSION_ID, buses, fecha: dbStatus?.fecha || '', empresa: dbStatus?.empresa || '', denominacion: dbStatus?.denominacion || '', dias: dtDias }),
      });
      setBusesDT(prev => {
        const next = new Set(prev);
        buses.forEach(b => next.add(b));
        return next;
      });
      setSelectedBuses(new Set());
      gridRef.current?.api?.deselectAll();
    } catch (e) { alert('Error: ' + e.message); } finally { setActionLoading(false); }
  };

  const guardarIntercambio = async () => {
    if (!intercambioPlacaOriginal || !intercambioPlacaNueva) return;
    setActionLoading(true);
    const busOriginal = cruce.find(r => r.BUS === intercambioPlacaOriginal.toUpperCase());
    const tarifaOriginal = busOriginal ? (busOriginal.TARIFA || 0) : 0;
    try {
      const res = await api('/api/intercambios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha: dbStatus?.fecha || '',
          empresa: dbStatus?.empresa || '',
          denominacion: dbStatus?.denominacion || '',
          placa_original: intercambioPlacaOriginal,
          placa_nueva: intercambioPlacaNueva,
          tarifa_original: tarifaOriginal,
        }),
      });
      if (res.status === 'ok') {
        setIntercambios(res.intercambios || []);
        setShowIntercambioModal(false);
        setIntercambioPlacaOriginal('');
        setIntercambioPlacaNueva('');
        setSelectedBuses(new Set());
        gridRef.current?.api?.deselectAll();
      }
    } catch (e) { alert('Error: ' + e.message); } finally { setActionLoading(false); }
  };

  const eliminarIntercambio = async (id) => {
    try {
      const res = await api('/api/intercambios/' + id, { method: 'DELETE' });
      if (res.status === 'ok') setIntercambios(res.intercambios || []);
    } catch {}
  };

  const darRebaja = async () => {
    if (selectedBuses.size !== 1) return;
    const bus = [...selectedBuses][0];
    const busRow = cruce.find(r => r.BUS === bus.toUpperCase());
    const tarifaOriginal = busRow ? (busRow.TARIFA || 0) : 0;
    if (tarifaOriginal <= 0) { alert('El bus no tiene tarifa registrada hoy'); return; }
    setActionLoading(true);
    try {
      const res = await api('/api/rebajas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha: dbStatus?.fecha || '',
          empresa: dbStatus?.empresa || '',
          denominacion: dbStatus?.denominacion || '',
          bus,
          tarifa_original: tarifaOriginal,
        }),
      });
      if (res.status === 'ok') {
        setRebajas(res.rebajas || []);
        setSelectedBuses(new Set());
        gridRef.current?.api?.deselectAll();
      }
    } catch (e) { alert('Error: ' + e.message); } finally { setActionLoading(false); }
  };

  const eliminarRebaja = async (id) => {
    try {
      const res = await api('/api/rebajas/' + id, { method: 'DELETE' });
      if (res.status === 'ok') setRebajas(res.rebajas || []);
    } catch {}
  };

  const eliminarUnificacion = async (id) => {
    try {
      const res = await api('/api/unificaciones/' + id, { method: 'DELETE' });
      if (res.status === 'ok') setUnificaciones(res.unificaciones || []);
    } catch {}
  };

  const loadUnificaciones = async (fechaOverride) => {
    const f = fechaOverride || dbStatus?.fecha;
    if (!f) return;
    try {
      const [resUnif, resEjec, resInter, resDT, resReb] = await Promise.all([
        api(`/api/unificaciones?fecha=${encodeURIComponent(f)}&empresa=${encodeURIComponent(dbStatus?.empresa || '')}`),
        api(`/api/ejecutados?session_id=${SESSION_ID}&fecha=${encodeURIComponent(f)}`),
        api(`/api/intercambios?fecha=${encodeURIComponent(f)}&empresa=${encodeURIComponent(dbStatus?.empresa || '')}`),
        api(`/api/dt?session_id=${SESSION_ID}&fecha=${encodeURIComponent(f)}`),
        api(`/api/rebajas?fecha=${encodeURIComponent(f)}&empresa=${encodeURIComponent(dbStatus?.empresa || '')}`),
      ]);
      setUnificaciones(resUnif.unificaciones || []);
      setIntercambios(resInter.intercambios || []);
      setRebajas(resReb.rebajas || []);
      const ejec = new Set([
        ...(resUnif.unificaciones || []).flatMap(u => u.buses_origen || []),
        ...(resEjec.ejecutados_db || []),
      ]);
      setBusesEjecutados(ejec);
      setBusesDT(new Set(resDT.dt_buses_db || []));
    } catch {}
  };

  const getSemanasDisponibles = () => {
    const semanas = [];
    const hoy = new Date();
    hoy.setHours(12, 0, 0, 0);
    const dayOfWeek = hoy.getDay();
    const diffToMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const lunesActual = new Date(hoy);
    lunesActual.setDate(hoy.getDate() - diffToMon);
    for (let i = 0; i < 12; i++) {
      const lun = new Date(lunesActual);
      lun.setDate(lunesActual.getDate() - i * 7);
      const vie = new Date(lun);
      vie.setDate(lun.getDate() + 4);
      const lunesStr = lun.toISOString().split('T')[0];
      const label = `${lun.getDate().toString().padStart(2,'0')}/${(lun.getMonth()+1).toString().padStart(2,'0')} - ${vie.getDate().toString().padStart(2,'0')}/${(vie.getMonth()+1).toString().padStart(2,'0')}`;
      semanas.push({ value: lunesStr, label });
    }
    return semanas;
  };

  const loadAhorrosSemanal = async () => {
    if (!dbStatus?.fecha) return;
    let semanas = semanasSeleccionadas;
    if (semanas.length === 0) {
      const d = new Date(dbStatus.fecha + 'T12:00:00');
      const dayOfWeek = d.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const lunes = new Date(d);
      lunes.setDate(d.getDate() - diff);
      semanas = [lunes.toISOString().split('T')[0]];
    }
    setAhorrosLoading(true);
    try {
      const resultados = await Promise.all(semanas.map(lunesStr =>
        api('/api/ahorros/semanal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fecha_inicio: lunesStr, denominacion: dbStatus?.denominacion || '' }),
        })
      ));
      if (resultados.length === 1) {
        setAhorrosSemanal(resultados[0]);
      } else {
        const merged = {
          ahorro_total_semanal: resultados.reduce((s, r) => s + (r.ahorro_total_semanal || 0), 0),
          total_acciones: resultados.reduce((s, r) => s + (r.total_acciones || 0), 0),
          dias: resultados.flatMap(r => r.dias || []).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')),
          semanas: resultados.length,
        };
        setAhorrosSemanal(merged);
      }
    } catch (e) { alert('Error: ' + e.message); }
    setAhorrosLoading(false);
  };

  const toggleRebal = (idx) => setRebalOpen(prev => ({ ...prev, [idx]: !prev[idx] }));

  const empresaName = dbStatus?.empresa || '';

  return (
    <div className="app-layout">
      <Sidebar
        dbStatus={dbStatus} setDbStatus={setDbStatus}
        activeTab={activeTab} setActiveTab={setActiveTab}
        empresa={empresaName}
        onDataLoaded={(statusData) => {
          setCruce([]); setPersonas([]); setMetrics(null); setRebalanceo(null);
          setRutasData(null); setRouteDistances(null); setDetailPlaca(''); setUnificaciones([]); runProcess(statusData?.fecha);
        }}
      />

      <main className="main-content">
        <header className="app-header">
          <div>
            <h1>Optimizador de Buses de Cosecha</h1>
            <p className="app-header-sub">Analiza ocupacion, cruza rendimiento y reabastecimiento de buses.</p>
          </div>
          <div className="header-right">
            {empresaName && <span>{empresaName}</span>}
            <div className="header-avatar"><i className="fa-solid fa-user" /></div>
          </div>
        </header>


        {!cruce.length && !processing && (
          <div className="empty-state">
            <div className="empty-state-icon"><i className="fa-solid fa-chart-bar" style={{fontSize: 48}} /></div>
            <p>Conecta la BD para comenzar el analisis</p>
          </div>
        )}

        {processing && (
          <div className="processing-banner">
            <div className="spinner" /> Procesando datos — cruzando viajes, asistencia y rendimientos...
          </div>
        )}

        {activeTab === 'cosecha' && filteredMetrics && cruce.length > 0 && (
          <section className="metrics-row">
            <MetricCard title="BUSES" value={filteredMetrics.buses} color="red" icon={<i className="fa-solid fa-bus" />} />
            <MetricCard title="CAPACIDAD TOTAL" value={filteredMetrics.capacidad} color="green" icon={<i className="fa-solid fa-users" />} />
            <MetricCard title="PASAJEROS REALES" value={filteredMetrics.pasajeros_reales} color="green" icon={<i className="fa-solid fa-user-check" />} />
            <MetricCard title="ASIENTOS VACÍOS" value={filteredMetrics.asientos_vacios} color="red" icon={<i className="fa-solid fa-chair" />} />
            <MetricCard title="COSTO ASIENTOS VACIOS" value={(() => { const c = filteredMetrics.capacidad || 1, t = filteredMetrics.tarifa_total || 0, v = filteredMetrics.asientos_vacios > 0 ? filteredMetrics.asientos_vacios : 0; return `S/${(t / c * v).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`; })()} color="red" icon={<i className="fa-solid fa-scale-unbalanced" />} />
          </section>
        )}


        {activeTab === 'cosecha' && cruce.length > 0 && (() => {
          const sectorStats = {};
          const sectorBuses = {};
          filteredCruce.forEach(r => {
            const zona = (r.ZONA_PROCEDENCIA || '').toUpperCase().trim();
            const sector = ZONA_A_SECTOR[zona] || 'OTROS';
            if (!sectorStats[sector]) { sectorStats[sector] = { buses: 0, capacidad: 0, pasajeros: 0, tarifa: 0 }; sectorBuses[sector] = []; }
            sectorStats[sector].buses += 1;
            sectorStats[sector].capacidad += (r.CAPACIDAD || 0);
            sectorStats[sector].pasajeros += (r.PAS_REAL || 0);
            sectorStats[sector].tarifa += (r.TARIFA || 0);
            const distInfo = routeDistances?.[zona] || routeDistances?.[r.ZONA_PROCEDENCIA];
            sectorBuses[sector].push({ ...r, _km: distInfo?.distancia_km || null });
          });
          const sectores = Object.entries(sectorStats).sort((a, b) => b[1].capacidad - a[1].capacidad);
          return <>
            <section style={{ marginBottom: 0 }}>
              <h2 style={{ marginBottom: 12 }}><i className="fa-solid fa-layer-group" style={{ marginRight: 6 }} />Capacidad por Zona</h2>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                {(() => {
                  const totalBuses = sectores.reduce((sum, [, s]) => sum + s.buses, 0);
                  const totalCap = sectores.reduce((sum, [, s]) => sum + s.capacidad, 0);
                  const totalPas = sectores.reduce((sum, [, s]) => sum + s.pasajeros, 0);
                  const totalTarifa = sectores.reduce((sum, [, s]) => sum + s.tarifa, 0);
                  const totalPct = totalCap > 0 ? Math.round(totalPas / totalCap * 100) : 0;
                  const totalCostoPP = totalPas > 0 ? (totalTarifa / totalPas).toFixed(2) : '0';
                  return (
                    <div style={{ flex: '1 1 160px', maxWidth: 220, padding: '12px 16px', borderRadius: 10, background: 'var(--bg-card, #fff)', border: '1.5px solid #1e293b30', position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: '#e5e7eb' }}>
                        <div style={{ height: '100%', width: `${totalPct}%`, background: '#1e293b', transition: 'width .3s' }} />
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>TOTAL</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{totalPas}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-dim)' }}>/{totalCap}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{totalBuses} buses</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: totalPct >= 80 ? 'var(--green)' : totalPct >= 50 ? '#ca8a04' : 'var(--red)' }}>{totalPct}%</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#1e293b', fontWeight: 600, marginTop: 4 }}>S/{totalCostoPP} /persona</div>
                    </div>
                  );
                })()}
                {sectores.map(([sector, s]) => {
                  const pct = s.capacidad > 0 ? Math.round(s.pasajeros / s.capacidad * 100) : 0;
                  const costoPP = s.pasajeros > 0 ? (s.tarifa / s.pasajeros).toFixed(2) : '0';
                  const color = SECTOR_COLORS[sector] || '#6b7280';
                  const isExpanded = expandedSector === sector;
                  return (
                    <div key={sector} onClick={() => setExpandedSector(isExpanded ? null : sector)} style={{ flex: '1 1 160px', maxWidth: 220, padding: '12px 16px', borderRadius: 10, background: 'var(--bg-card, #fff)', border: `1.5px solid ${isExpanded ? color : color + '30'}`, position: 'relative', overflow: 'hidden', cursor: 'pointer', transition: 'all .15s', boxShadow: isExpanded ? `0 2px 8px ${color}25` : 'none' }}>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: '#e5e7eb' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width .3s' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{sector}</div>
                        <i className={`fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}`} style={{ fontSize: 10, color: 'var(--text-dim)' }} />
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{s.pasajeros}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-dim)' }}>/{s.capacidad}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{s.buses} buses</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: pct >= 80 ? 'var(--green)' : pct >= 50 ? '#ca8a04' : 'var(--red)' }}>{pct}%</span>
                      </div>
                      <div style={{ fontSize: 11, color, fontWeight: 600, marginTop: 4 }}>S/{costoPP} /persona</div>
                    </div>
                  );
                })}
              </div>
              {expandedSector && sectorBuses[expandedSector] && (
                <div style={{ background: 'var(--bg-card, #fff)', border: `1.5px solid ${SECTOR_COLORS[expandedSector] || '#6b7280'}30`, borderRadius: 10, padding: 16, marginBottom: 16, animation: 'fadeIn .2s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <h3 style={{ margin: 0, fontSize: 14 }}>
                      <span style={{ color: SECTOR_COLORS[expandedSector] || '#6b7280', marginRight: 6 }}>●</span>
                      Buses en {expandedSector}
                      <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-dim)', marginLeft: 8 }}>{sectorBuses[expandedSector].length} buses</span>
                    </h3>
                    <button onClick={(e) => { e.stopPropagation(); setExpandedSector(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-dim)' }}>✕</button>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="mini-table" style={{ width: '100%', fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Bus</th>
                          <th>Zona</th>
                          <th>Ruta</th>
                          <th style={{ textAlign: 'right' }}>Cap.</th>
                          <th style={{ textAlign: 'right' }}>Pas.</th>
                          <th style={{ textAlign: 'right' }}>% Ocup.</th>
                          <th style={{ textAlign: 'right' }}>Vacíos</th>
                          <th style={{ textAlign: 'right' }}>Tarifa</th>
                          <th style={{ textAlign: 'right' }}>Km</th>
                          <th style={{ textAlign: 'right' }}>S//Km</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sectorBuses[expandedSector].sort((a, b) => (a.PORCENTAJE_OCUP || 0) - (b.PORCENTAJE_OCUP || 0)).map(r => {
                          const ocup = r.CAPACIDAD > 0 ? Math.round((r.PAS_REAL || 0) / r.CAPACIDAD * 100) : 0;
                          const vacios = (r.CAPACIDAD || 0) - (r.PAS_REAL || 0);
                          const costoKm = r._km && r._km > 0 ? ((r.TARIFA || 0) / r._km).toFixed(2) : '—';
                          return (
                            <tr key={r.BUS}>
                              <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{r.BUS}</td>
                              <td>{r.ZONA_PROCEDENCIA}</td>
                              <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.RUTA}</td>
                              <td style={{ textAlign: 'right', color: 'var(--green)', fontWeight: 600 }}>{r.CAPACIDAD}</td>
                              <td style={{ textAlign: 'right' }}>{r.PAS_REAL || 0}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700, color: ocup >= 80 ? 'var(--green)' : ocup >= 50 ? '#ca8a04' : 'var(--red)' }}>{ocup}%</td>
                              <td style={{ textAlign: 'right', color: vacios > 0 ? 'var(--red)' : 'var(--green)' }}>{Math.max(vacios, 0)}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>S/{(r.TARIFA || 0).toLocaleString('es-PE')}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{r._km ? r._km.toFixed(1) : '—'}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{costoKm !== '—' ? `S/${costoKm}` : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        {(() => {
                          const buses = sectorBuses[expandedSector];
                          const totCap = buses.reduce((s, r) => s + (r.CAPACIDAD || 0), 0);
                          const totPas = buses.reduce((s, r) => s + (r.PAS_REAL || 0), 0);
                          const totVacios = Math.max(totCap - totPas, 0);
                          const avgOcup = totCap > 0 ? Math.round(totPas / totCap * 100) : 0;
                          const totTarifa = buses.reduce((s, r) => s + (r.TARIFA || 0), 0);
                          return (
                            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                              <td colSpan={3}>TOTAL / PROMEDIO</td>
                              <td style={{ textAlign: 'right' }}>{totCap}</td>
                              <td style={{ textAlign: 'right' }}>{totPas}</td>
                              <td style={{ textAlign: 'right', color: avgOcup >= 80 ? 'var(--green)' : avgOcup >= 50 ? '#ca8a04' : 'var(--red)' }}>{avgOcup}%</td>
                              <td style={{ textAlign: 'right', color: 'var(--red)' }}>{totVacios}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>S/{totTarifa.toLocaleString('es-PE')}</td>
                              <td colSpan={2}></td>
                            </tr>
                          );
                        })()}
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </section>

            <section>
              <h2>Cruce de Datos</h2>
              <div className="filters-row">
                <MultiSelectFilter label="Todas las CCE/Com." options={filters.cecos} selected={selCeco} onChange={setSelCeco} />
                <MultiSelectFilter label="Todas las Zonas" options={filters.zonas} selected={selZona} onChange={setSelZona} />
                <MultiSelectFilter label="Todos los Pasos" options={filters.placas} selected={selPlaca} onChange={setSelPlaca} />
                <input
                  type="text"
                  placeholder="Buscar por placa..."
                  value={searchPlaca}
                  onChange={e => setSearchPlaca(e.target.value)}
                />
                <button onClick={runProcess} className="btn btn-sm" title="Reprocesar"><i className="fa-solid fa-rotate-right" style={{marginRight: 4}} /> Reprocesar</button>
              </div>
              <div className="ag-theme-alpine grid-container">
                <AgGridReact
                  ref={gridRef}
                  rowData={filteredCruce}
                  columnDefs={cruceColumns}
                  defaultColDef={{ resizable: true, sortable: true, filter: true }}
                  domLayout="autoHeight"
                  pagination
                  paginationPageSize={20}
                  animateRows
                  rowSelection="multiple"
                  suppressRowClickSelection
                  onSelectionChanged={e => {
                    const selected = e.api.getSelectedRows().map(r => r.BUS);
                    setSelectedBuses(new Set(selected));
                  }}
                  onRowClicked={e => {
                    const placa = e.data?.BUS;
                    if (placa) {
                      setDetailPlaca(placa);
                      setShowDetailModal(true);
                    }
                  }}
                  rowStyle={{ cursor: 'pointer' }}
                />
              </div>
            </section>

            {showUnificarModal && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowUnificarModal(false)}>
                <div style={{ background: '#fff', borderRadius: 12, width: '90%', maxWidth: 500, padding: 24, position: 'relative' }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => setShowUnificarModal(false)} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' }}>×</button>
                  <h3 style={{ margin: '0 0 16px' }}><i className="fa-solid fa-compress" style={{ marginRight: 8, color: '#7c3aed' }} />Unificar Buses</h3>
                  <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
                    Buses seleccionados: <b>{[...selectedBuses].join(', ')}</b>
                  </p>
                  <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: 'block' }}>Placa destino para el día siguiente:</label>
                  <input
                    type="text"
                    value={unificarPlaca}
                    onChange={e => setUnificarPlaca(e.target.value.toUpperCase())}
                    placeholder="Ej: T1G-967"
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, marginBottom: 16, fontFamily: 'var(--mono)' }}
                  />
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowUnificarModal(false)} className="btn" style={{ background: '#f1f5f9', color: '#334155' }}>Cancelar</button>
                    <button onClick={() => guardarUnificacion(unificarPlaca)} disabled={!unificarPlaca.trim() || actionLoading} className="btn" style={{ background: '#7c3aed', color: '#fff', border: 'none', opacity: (unificarPlaca.trim() && !actionLoading) ? 1 : 0.5 }}>
                      <i className="fa-solid fa-check" style={{ marginRight: 4 }} />Guardar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showIntercambioModal && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowIntercambioModal(false)}>
                <div style={{ background: '#fff', borderRadius: 12, width: '90%', maxWidth: 500, padding: 24, position: 'relative' }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => setShowIntercambioModal(false)} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' }}>x</button>
                  <h3 style={{ margin: '0 0 16px' }}><i className="fa-solid fa-right-left" style={{ marginRight: 8, color: '#2563eb' }} />Intercambiar Placa</h3>
                  <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
                    Placa original: <b>{intercambioPlacaOriginal}</b>
                    {(() => { const b = cruce.find(r => r.BUS === intercambioPlacaOriginal); return b ? ` — Tarifa: S/${b.TARIFA?.toLocaleString()}` : ''; })()}
                  </p>
                  <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: 'block' }}>Placa nueva (reemplazo):</label>
                  <input
                    type="text"
                    value={intercambioPlacaNueva}
                    onChange={e => setIntercambioPlacaNueva(e.target.value.toUpperCase())}
                    placeholder="Ej: X2Y-123"
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, marginBottom: 16, fontFamily: 'var(--mono)' }}
                  />
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowIntercambioModal(false)} className="btn" style={{ background: '#f1f5f9', color: '#334155' }}>Cancelar</button>
                    <button onClick={guardarIntercambio} disabled={!intercambioPlacaNueva.trim() || actionLoading} className="btn" style={{ background: '#2563eb', color: '#fff', border: 'none', opacity: (intercambioPlacaNueva.trim() && !actionLoading) ? 1 : 0.5 }}>
                      <i className="fa-solid fa-check" style={{ marginRight: 4 }} />Guardar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showDTModal && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowDTModal(false)}>
                <div style={{ background: '#fff', borderRadius: 12, width: '90%', maxWidth: 400, padding: 24, position: 'relative' }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => setShowDTModal(false)} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' }}>x</button>
                  <h3 style={{ margin: '0 0 16px' }}><i className="fa-solid fa-wrench" style={{ marginRight: 8, color: '#4338ca' }} />Descanso Tecnico</h3>
                  <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
                    Buses seleccionados: <b>{selectedBuses.size}</b> ({[...selectedBuses].join(', ')})
                  </p>
                  <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: 'block' }}>Dias de DT:</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={dtDias}
                    onChange={e => setDtDias(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, marginBottom: 16 }}
                  />
                  <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>
                    <i className="fa-solid fa-info-circle" style={{ marginRight: 4 }} />
                    El DT se aplica a partir del siguiente dia habil por {dtDias} dia{dtDias > 1 ? 's' : ''} (salta fines de semana).
                  </p>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowDTModal(false)} className="btn" style={{ background: '#f1f5f9', color: '#334155' }}>Cancelar</button>
                    <button onClick={confirmarDT} className="btn" style={{ background: '#4338ca', color: '#fff', border: 'none' }}>
                      <i className="fa-solid fa-check" style={{ marginRight: 4 }} />Confirmar DT
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showDetailModal && detailPlaca && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowDetailModal(false)}>
                <div style={{ background: '#fff', borderRadius: 12, width: '90%', maxWidth: 900, maxHeight: '85vh', overflow: 'auto', padding: 24, position: 'relative', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => setShowDetailModal(false)} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b7280' }}>&times;</button>
                  <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>
                    <i className="fa-solid fa-bus" style={{ marginRight: 8, color: '#3b82f6' }} />
                    Detalle — {detailPlaca}
                  </h2>
                  {detailBusInfo && (
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, padding: 12, background: '#f0f9ff', borderRadius: 8, fontSize: 13 }}>
                      <div><b>Tipo:</b> {detailBusInfo.T_BUS || detailBusInfo.TIPO}</div>
                      <div><b>Proveedor:</b> {detailBusInfo.PROVEEDOR || '—'}</div>
                      <div><b>Ruta:</b> {detailBusInfo.ZONA_PROCEDENCIA} → {detailBusInfo.CECO}</div>
                      <div><b>Capacidad:</b> {detailBusInfo.CAPACIDAD}</div>
                      <div><b>Reporte:</b> {detailBusInfo.PAS_IDA_VIAJES}</div>
                      <div><b>Real:</b> {detailPersons.filter(p => !p.CESADO).length}</div>
                      {detailPersons.some(p => p.CESADO) && <div style={{ color: '#dc2626', fontWeight: 700 }}><b>Cesados:</b> {detailPersons.filter(p => p.CESADO).length}</div>}
                      <div><b>% Ocup:</b> {detailBusInfo.PORCENTAJE_OCUP ?? '—'}%</div>
                      <div><b>Tarifa:</b> S/{detailBusInfo.TARIFA?.toLocaleString() ?? '—'}</div>
                    </div>
                  )}
                  {detailPersons.length > 0 ? (
                    <div className="ag-theme-alpine" style={{ width: '100%' }}>
                      <AgGridReact rowData={detailPersons} columnDefs={detailColumns}
                        defaultColDef={{ resizable: true, sortable: true }} domLayout="autoHeight" animateRows
                        getRowStyle={params => params.data?.CESADO ? { background: '#fef2f2', color: '#991b1b' } : null} />
                    </div>
                  ) : (
                    <p style={{ textAlign: 'center', color: '#9ca3af', padding: 24 }}>No se encontraron personas para esta placa.</p>
                  )}
                </div>
              </div>
            )}

            <hr className="section-divider" />

            <section className="rebalanceo-section">
              <h2>Rebalanceo de Buses</h2>
              <div className="rebal-controls">
                <label>
                  Umbral de ocupacion:
                  <strong>0 - {umbral}%</strong>
                  <input type="range" min={30} max={95} step={5} value={umbral} onChange={e => setUmbral(+e.target.value)} />
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {selectedBuses.size > 0 && (
                    <span style={{ fontSize: 13, color: '#3b82f6', fontWeight: 600 }}>
                      <i className="fa-solid fa-check-double" style={{ marginRight: 4 }} />
                      {selectedBuses.size} bus{selectedBuses.size > 1 ? 'es' : ''} seleccionado{selectedBuses.size > 1 ? 's' : ''}
                    </span>
                  )}
                  <button onClick={runRebalanceo} disabled={rebalLoading} className="btn btn-primary">
                    {rebalLoading ? <><span className="spinner" style={{ marginRight: 8 }} /> Calculando...</> : selectedBuses.size > 0 ? `Rebalancear ${selectedBuses.size} bus${selectedBuses.size > 1 ? 'es' : ''}` : 'Calcular Rebalanceo'}
                  </button>
                  {selectedBuses.size > 0 && (
                    <button onClick={() => setShowUnificarModal(true)} className="btn" style={{ background: '#7c3aed', color: '#fff', border: 'none' }}>
                      <i className="fa-solid fa-compress" style={{ marginRight: 4 }} />
                      Unificar ({selectedBuses.size})
                    </button>
                  )}
                  {selectedBuses.size === 1 && (
                    <>
                      <button onClick={() => { setIntercambioPlacaOriginal([...selectedBuses][0]); setShowIntercambioModal(true); }} className="btn" style={{ background: '#2563eb', color: '#fff', border: 'none' }}>
                        <i className="fa-solid fa-right-left" style={{ marginRight: 4 }} />
                        Intercambiar
                      </button>
                      <button onClick={darRebaja} disabled={actionLoading} className="btn" style={{ background: '#059669', color: '#fff', border: 'none', opacity: actionLoading ? 0.6 : 1 }}>
                        {actionLoading ? <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 4 }} /> : <i className="fa-solid fa-arrow-trend-down" style={{ marginRight: 4 }} />}
                        Rebaja
                      </button>
                    </>
                  )}
                  {selectedBuses.size > 0 && (
                    <>
                      <button onClick={darDeBaja} disabled={actionLoading} className="btn" style={{ background: '#dc2626', color: '#fff', border: 'none', opacity: actionLoading ? 0.6 : 1 }}>
                        {actionLoading ? <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 4 }} /> : <i className="fa-solid fa-ban" style={{ marginRight: 4 }} />}
                        Dar de Baja ({selectedBuses.size})
                      </button>
                      <button onClick={darDT} disabled={actionLoading} className="btn" style={{ background: '#4338ca', color: '#fff', border: 'none', opacity: actionLoading ? 0.6 : 1 }}>
                        {actionLoading ? <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 4 }} /> : <i className="fa-solid fa-wrench" style={{ marginRight: 4 }} />}
                        DT ({selectedBuses.size})
                      </button>
                    </>
                  )}
                </div>
                {(busesProgramados.size > 0 || unificaciones.length > 0 || busesEjecutados.size > 0) && (
                  <div style={{ display: 'flex', gap: 16, fontSize: 13, marginTop: 8 }}>
                    <span style={{ color: '#f59e0b', fontWeight: 600 }}>
                      <i className="fa-solid fa-clock" style={{ marginRight: 4 }} />
                      Sugeridos: {busesProgramados.size}
                    </span>
                    <span style={{ color: '#7c3aed', fontWeight: 600 }}>
                      <i className="fa-solid fa-compress" style={{ marginRight: 4 }} />
                      Unificados: {unificaciones.length}
                    </span>
                    {busesDT.size > 0 && (
                      <span style={{ color: '#4338ca', fontWeight: 600 }}>
                        <i className="fa-solid fa-wrench" style={{ marginRight: 4 }} />
                        DT: {busesDT.size}
                      </span>
                    )}
                    {busesEjecutados.size > 0 && (
                      <span style={{ color: '#dc2626', fontWeight: 600 }}>
                        <i className="fa-solid fa-ban" style={{ marginRight: 4 }} />
                        De baja: {busesEjecutados.size}
                      </span>
                    )}
                    {intercambios.length > 0 && (
                      <span style={{ color: '#2563eb', fontWeight: 600 }}>
                        <i className="fa-solid fa-right-left" style={{ marginRight: 4 }} />
                        Intercambios: {intercambios.length}
                      </span>
                    )}
                    {rebajas.length > 0 && (
                      <span style={{ color: '#059669', fontWeight: 600 }}>
                        <i className="fa-solid fa-arrow-trend-down" style={{ marginRight: 4 }} />
                        Rebajas: {rebajas.length}
                      </span>
                    )}
                  </div>
                )}
                {rebajas.length > 0 && (
                  <div style={{ marginTop: 10, padding: 12, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#059669', marginBottom: 8 }}>Rebajas de tarifa registradas:</div>
                    {rebajas.map(rb => (
                      <div key={rb.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0' }}>
                        <span><strong>{rb.bus}</strong> — tarifa base S/{rb.tarifa_original.toLocaleString(undefined, { minimumFractionDigits: 2 })} (ahorro desde mañana)</span>
                        <button onClick={() => eliminarRebaja(rb.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 11 }}>
                          <i className="fa-solid fa-xmark" /> Quitar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {unificaciones.length > 0 && (
                  <div style={{ marginTop: 10, padding: 12, background: '#f5f3ff', borderRadius: 8, border: '1px solid #ddd6fe' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>Unificaciones guardadas:</div>
                    {unificaciones.map(u => (
                      <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #ede9fe', fontSize: 12 }}>
                        <span style={{ fontFamily: 'var(--mono)', color: '#64748b' }}>{(u.buses_origen || []).join(', ')}</span>
                        <i className="fa-solid fa-arrow-right" style={{ color: '#7c3aed', fontSize: 10 }} />
                        <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: '#7c3aed' }}>{u.placa_destino}</span>
                        <span style={{ color: '#94a3b8', fontSize: 11 }}>(día siguiente)</span>
                        <button onClick={() => eliminarUnificacion(u.id)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>
                          <i className="fa-solid fa-trash-can" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {intercambios.length > 0 && (
                  <div style={{ marginTop: 10, padding: 12, background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', marginBottom: 8 }}>Intercambios guardados:</div>
                    {intercambios.map(ic => (
                      <div key={ic.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #dbeafe', fontSize: 12 }}>
                        <span style={{ fontFamily: 'var(--mono)', color: '#64748b' }}>{ic.placa_original}</span>
                        <i className="fa-solid fa-right-left" style={{ color: '#2563eb', fontSize: 10 }} />
                        <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: '#2563eb' }}>{ic.placa_nueva}</span>
                        <span style={{ color: '#94a3b8', fontSize: 11 }}>Tarifa orig: S/{ic.tarifa_original?.toLocaleString()}</span>
                        <button onClick={() => eliminarIntercambio(ic.id)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>
                          <i className="fa-solid fa-trash-can" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {rebalanceo?.resumen && (
                <div className="rebal-summary">
                  <MetricCard title="Buses eliminables" value={rebalanceo.resumen.buses_eliminables} color="red" icon={<i className="fa-solid fa-ban" />} />
                  <MetricCard title="Personas reasignadas" value={rebalanceo.resumen.personas_reasignables} color="yellow" icon={<i className="fa-solid fa-people-arrows" />} />
                  <MetricCard title="Reubicados" value={rebalanceo.resumen.sin_espacio} color="red" icon={<i className="fa-solid fa-triangle-exclamation" />} />
                  <MetricCard title="Pérdida total" value={`S/${(rebalanceo.recomendaciones?.reduce((sum, r) => sum + (r.perdida || 0), 0) || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`} color="red" icon={<i className="fa-solid fa-money-bill-wave" />} />
                </div>
              )}

              {rutasData && <RouteMap rutasData={rutasData} onDistancesReady={setRouteDistances} />}

              {rebalanceo?.recomendaciones?.map((rec, idx) => {
                const asigs = rec.asignaciones || rec.personas_reasignables || [];
                const jarrasValues = asigs.map(p => p.PROM_JARRAS_SEM ?? p.rendimiento ?? 0).filter(v => v > 0);
                const promJarras = jarrasValues.length > 0 ? (jarrasValues.reduce((a, b) => a + b, 0) / jarrasValues.length).toFixed(1) : '0';
                return (
                <div key={idx} className={`rebal-card ${rebalOpen[idx] ? 'open' : ''}`}>
                  <div className="rebal-card-header" onClick={() => toggleRebal(idx)}>
                    {rec.es_receptor && (
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#fff', marginRight: 6, background: '#2563eb' }}>
                        RECEPTOR
                      </span>
                    )}
                    {rec.prioridad && (
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#fff', marginRight: 6, background: rec.prioridad === 'critico' ? '#dc2626' : rec.prioridad === 'urgente' ? '#f59e0b' : '#6b7280' }}>
                        {rec.prioridad === 'critico' ? 'CRITICO' : rec.prioridad === 'urgente' ? 'URGENTE' : 'RECOMENDADO'}
                      </span>
                    )}
                    <span className="rebal-placa">{rec.placa || rec.placa_origen || rec.bus}</span>
                    <span className="rebal-info">
                      {rec.zona && <span className="badge" style={{marginRight:6}}>{rec.zona}</span>}
                      {rec.ruta || rec.tipo || ''} &nbsp;|&nbsp; {rec.pasajeros ?? '?'}/{rec.capacidad ?? '?'}
                      &nbsp;|&nbsp; Tarifa: S/{rec.tarifa?.toLocaleString() ?? '?'}
                      &nbsp;|&nbsp; Costo/Pas: S/{rec.costo_pasajero?.toFixed(2) ?? '?'}
                      &nbsp;|&nbsp; <span style={{color:'var(--red)', fontWeight:700}}>Pérdida: S/{rec.perdida?.toLocaleString() ?? '?'}</span>
                      &nbsp;|&nbsp; <span style={{color:'#059669', fontWeight:600}}>Prom. Jarras: {promJarras}</span>
                      {rec.consolidar_con && <>&nbsp;|&nbsp; <span style={{color:'#7c3aed', fontWeight:700}}>Unir con: {rec.consolidar_con}</span></>}
                    </span>
                    <span className="rebal-occ" style={{ color: occColor(rec.ocupacion_pct ?? rec.ocup ?? 0) }}>
                      {rec.ocupacion_pct ?? rec.ocup ?? 0}%
                    </span>
                    <span className="rebal-toggle">▼</span>
                  </div>
                  {rebalOpen[idx] && (
                    <div className="rebal-card-body">
                      {(rec.asignaciones || rec.personas_reasignables) && (
                        <div>
                          <h4>Personas reasignables (por rendimiento)</h4>
                          <table className="mini-table">
                            <thead>
                              <tr><th>DNI</th><th>Pasajero</th><th>Grupo</th><th>Actividad</th><th>Jarras/Sem</th><th>Bus Destino</th><th>Zona Destino</th><th>Tipo</th><th>CECO Destino</th></tr>
                            </thead>
                            <tbody>
                              {(rec.asignaciones || rec.personas_reasignables || []).map((p, i) => {
                                return (
                                <tr key={i}>
                                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{p.DNI || p.dni}</td>
                                  <td>{p.PASAJERO || p.pasajero || p.nombre}</td>
                                  <td>{p.GRUPO || '-'}</td>
                                  <td>{p.ACTIVIDAD || p.actividad || '-'}</td>
                                  <td style={{ fontFamily: 'var(--mono)', color: (p.PROM_JARRAS_SEM || p.rendimiento || 0) >= 50 ? 'var(--green)' : 'inherit' }}>
                                    {p.PROM_JARRAS_SEM ?? p.rendimiento ?? '-'}
                                  </td>
                                  <td style={{ fontFamily: 'var(--mono)' }}>{p.BUS_DESTINO || p.destino || '-'}</td>
                                  <td>{p.ZONA_DESTINO || '-'}</td>
                                  <td style={{ fontSize: 11, color: p.TIPO_REASIGNACION === 'parada_en_ruta' ? '#b45309' : p.TIPO_REASIGNACION === 'mismo_origen' ? '#1d4ed8' : '#166534' }}>
                                    {p.TIPO_REASIGNACION === 'misma_zona' ? 'Misma zona' : p.TIPO_REASIGNACION === 'mismo_origen' ? 'Mismo origen' : p.TIPO_REASIGNACION === 'parada_en_ruta' ? 'Parada en ruta' : '-'}
                                  </td>
                                  <td>{p.CECO_DESTINO || '-'}</td>
                                </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })}

              {rebalanceo && (
                <div style={{ marginTop: 24, padding: 20, background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <h3 style={{ margin: 0 }}><i className="fa-solid fa-scale-balanced" style={{ marginRight: 8 }} />Comparativa de Ejecución</h3>
                    <button onClick={loadCompEjec} disabled={compEjecLoading} className="btn btn-primary" style={{ fontSize: 13 }}>
                      {compEjecLoading ? <><span className="spinner" style={{ marginRight: 6 }} />Comparando...</> : <><i className="fa-solid fa-chart-column" style={{ marginRight: 4 }} />Comparar con día siguiente</>}
                    </button>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 12px' }}>
                    Compara todos los buses del CECO del <b>{dbStatus?.fecha}</b> con el día siguiente para ver el ahorro general.
                  </p>

                  {compEjec && !compEjec.error && (
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
                        {[
                          { label: 'Ocupación', key: 'ocupacion', unit: '%', good: 'up' },
                          { label: 'Ahorro', key: 'perdida', unit: 'S/', good: 'down' },
                          { label: 'Costo/Persona', key: 'costo_por_persona', unit: 'S/', good: 'down' },
                          { label: 'Pasajeros', key: 'pasajeros', unit: '', good: 'up' },
                          { label: 'Asientos vacíos', key: 'vacios', unit: '', good: 'down' },
                        ].map(m => {
                          const mejora = compEjec.mejoras?.[m.key];
                          if (!mejora) return null;
                          const isGood = m.good === 'up' ? mejora.valor > 0 : mejora.valor < 0;
                          const isBad = m.good === 'up' ? mejora.valor < 0 : mejora.valor > 0;
                          return (
                            <div key={m.key} style={{ padding: 14, borderRadius: 10, background: isGood ? '#f0fdf4' : isBad ? '#fef2f2' : '#f8fafc', border: `1px solid ${isGood ? '#bbf7d0' : isBad ? '#fecaca' : '#e2e8f0'}` }}>
                              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{m.label}</div>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                <span style={{ fontSize: 20, fontWeight: 700, color: isGood ? '#16a34a' : isBad ? '#dc2626' : '#334155' }}>
                                  {mejora.valor > 0 ? '+' : ''}{m.unit === 'S/' ? `S/${Math.abs(mejora.valor).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}` : mejora.valor}
                                </span>
                                <span style={{ fontSize: 12, color: isGood ? '#16a34a' : isBad ? '#dc2626' : '#64748b' }}>
                                  ({mejora.pct > 0 ? '+' : ''}{mejora.pct}%)
                                </span>
                              </div>
                              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                                {compEjec.dia_ejecucion?.[m.key]} → {compEjec.dia_siguiente?.[m.key]}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        {['dia_ejecucion', 'dia_siguiente'].map(dia => {
                          const d = compEjec[dia];
                          if (!d) return null;
                          return (
                            <div key={dia} style={{ padding: 14, borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                              <h4 style={{ margin: '0 0 10px', fontSize: 13 }}>
                                {dia === 'dia_ejecucion' ? <><i className="fa-solid fa-calendar-check" style={{ marginRight: 6 }} />Día de ejecución</> : <><i className="fa-solid fa-calendar-day" style={{ marginRight: 6 }} />Día siguiente</>}: <b>{d.fecha}</b>
                              </h4>
                              <div style={{ fontSize: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                                <span>Buses total: <b>{d.buses_total}</b> {d.buses_ejecutados > 0 && <span style={{ color: '#16a34a' }}>(Ejecutados: {d.buses_ejecutados})</span>}</span>
                                <span>Ocupación: <b>{d.ocupacion}%</b></span>
                                <span>Pasajeros: <b>{d.pasajeros}</b></span>
                                <span>Capacidad: <b>{d.capacidad}</b></span>
                                <span>Ahorro: <b style={{ color: '#059669' }}>S/{d.perdida?.toLocaleString()}</b></span>
                                <span>Costo/Persona: <b>S/{d.costo_por_persona}</b></span>
                              </div>
                              {d.buses_detail?.length > 0 && (
                                <details style={{ marginTop: 8 }}>
                                  <summary style={{ cursor: 'pointer', fontSize: 12, color: '#3b82f6' }}>Ver detalle por bus ({d.buses_detail.length})</summary>
                                  <table className="mini-table" style={{ marginTop: 6 }}>
                                    <thead><tr><th></th><th>Bus</th><th>Cap</th><th>Pas</th><th>Ocup%</th><th>Pérdida</th><th>Costo/PP</th></tr></thead>
                                    <tbody>
                                      {d.buses_detail.map((b, i) => (
                                        <tr key={i} style={b.EJECUTADO ? { background: '#f0fdf4', fontWeight: 600 } : {}}>
                                          <td>{b.EJECUTADO ? <i className="fa-solid fa-circle-check" style={{ color: '#16a34a' }} /> : ''}</td>
                                          <td style={{ fontFamily: 'var(--mono)' }}>{b.BUS}</td>
                                          <td>{b.CAPACIDAD}</td>
                                          <td>{b.PAS}</td>
                                          <td style={{ color: b.OCUP >= 70 ? '#16a34a' : b.OCUP >= 50 ? '#f59e0b' : '#dc2626' }}>{b.OCUP}%</td>
                                          <td style={{ color: '#dc2626' }}>S/{b.PERDIDA?.toLocaleString()}</td>
                                          <td>S/{b.COSTO_PP}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </details>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {compEjec?.error && <div style={{ color: '#dc2626', fontSize: 13 }}>{compEjec.error}</div>}
                </div>
              )}
              {/* ── Reporte de Ahorros Semanal ── */}
              {rebalanceo && (
                <div style={{ marginTop: 24, padding: 20, background: 'var(--bg-card)', borderRadius: 12, border: '1.5px solid #059669' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                    <h3 style={{ margin: 0, color: '#059669' }}><i className="fa-solid fa-piggy-bank" style={{ marginRight: 8 }} />Reporte de Ahorros{semanasSeleccionadas.length > 1 ? ` (${semanasSeleccionadas.length} semanas)` : ' Semanal'}</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ position: 'relative' }}>
                        <button
                          onClick={() => setShowSemanasDropdown(!showSemanasDropdown)}
                          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 12, minWidth: 180, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          <i className="fa-solid fa-calendar-week" />
                          {semanasSeleccionadas.length === 0 ? 'Semana actual' : `${semanasSeleccionadas.length} semana${semanasSeleccionadas.length > 1 ? 's' : ''}`}
                          <i className={`fa-solid fa-chevron-${showSemanasDropdown ? 'up' : 'down'}`} style={{ marginLeft: 'auto', fontSize: 10 }} />
                        </button>
                        {showSemanasDropdown && (
                          <>
                            <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={() => setShowSemanasDropdown(false)} />
                            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 999, minWidth: 220, maxHeight: 300, overflowY: 'auto' }}>
                              <div style={{ padding: '6px 10px', borderBottom: '1px solid #e5e7eb', fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Seleccionar semanas</div>
                              {getSemanasDisponibles().map(s => {
                                const checked = semanasSeleccionadas.includes(s.value);
                                return (
                                  <label key={s.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12, background: checked ? '#f0fdf4' : 'transparent' }}
                                    onMouseEnter={e => e.currentTarget.style.background = checked ? '#dcfce7' : '#f9fafb'}
                                    onMouseLeave={e => e.currentTarget.style.background = checked ? '#f0fdf4' : 'transparent'}
                                  >
                                    <input type="checkbox" checked={checked} onChange={() => {
                                      setSemanasSeleccionadas(prev => checked ? prev.filter(v => v !== s.value) : [...prev, s.value]);
                                    }} style={{ accentColor: '#059669' }} />
                                    Sem {s.label}
                                  </label>
                                );
                              })}
                              {semanasSeleccionadas.length > 0 && (
                                <div style={{ padding: '6px 10px', borderTop: '1px solid #e5e7eb' }}>
                                  <button onClick={() => setSemanasSeleccionadas([])} style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>
                                    <i className="fa-solid fa-xmark" style={{ marginRight: 4 }} />Limpiar seleccion
                                  </button>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                      <button onClick={loadAhorrosSemanal} disabled={ahorrosLoading} className="btn btn-primary" style={{ fontSize: 13, background: '#059669', border: 'none' }}>
                        {ahorrosLoading ? <><span className="spinner" style={{ marginRight: 6 }} />Calculando...</> : <><i className="fa-solid fa-calculator" style={{ marginRight: 4 }} />Calcular Ahorros</>}
                      </button>
                    </div>
                  </div>

                  {ahorrosSemanal && (
                    <div>
                      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 150px', padding: '12px 16px', borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', textAlign: 'center' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#059669', textTransform: 'uppercase' }}>Ahorro Total Semanal</div>
                          <div style={{ fontSize: 24, fontWeight: 800, color: '#059669' }}>S/{ahorrosSemanal.ahorro_total_semanal?.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
                        </div>
                        <div style={{ flex: '1 1 150px', padding: '12px 16px', borderRadius: 10, background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase' }}>Ahorro Total en US$</div>
                          <div style={{ fontSize: 24, fontWeight: 800, color: '#2563eb' }}>${((ahorrosSemanal.ahorro_total_semanal || 0) / tipoCambio).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
                        </div>
                        <div style={{ flex: '1 1 150px', padding: '12px 16px', borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', textAlign: 'center' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#059669', textTransform: 'uppercase' }}>Acciones ejecutadas</div>
                          <div style={{ fontSize: 24, fontWeight: 800, color: '#059669' }}>{ahorrosSemanal.total_acciones}</div>
                        </div>
                      </div>

                      <div style={{ overflowX: 'auto' }}>
                        <table className="mini-table" style={{ width: '100%', fontSize: 12 }}>
                          <thead>
                            <tr>
                              <th>Día</th>
                              <th>Kilos</th>
                              <th>Fecha</th>
                              <th>Nuevas Acciones</th>
                              <th>Costo Sin Optimizar</th>
                              <th>Costo Con Optimizar</th>
                              <th>Ahorro del Día</th>
                              <th>Acumulado</th>
                              <th>$/kg Sin Opt</th>
                              <th>$/kg Con Opt</th>
                              <th>Diferencia $/kg</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ahorrosSemanal.dias?.map((d, i) => (
                              <tr key={i} style={d.ahorro_dia > 0 ? { background: '#f0fdf410' } : {}}>
                                <td style={{ fontWeight: 600 }}>{d.dia}</td>
                                <td style={{ color: '#6366f1', fontWeight: 600 }}>{d.kilos_export > 0 ? `${d.kilos_export.toLocaleString(undefined, {maximumFractionDigits:0})} kg` : '—'}</td>
                                <td>{d.fecha}</td>
                                <td>
                                  {d.nuevas_acciones?.length > 0 ? d.nuevas_acciones.map((a, j) => (
                                    <div key={j} style={{ fontSize: 11, marginBottom: 2 }}>
                                      {a.tipo === 'dt' ? (
                                        <span><span style={{ color: '#4338ca', fontWeight: 600 }}>DT:</span> {a.bus} (S/{a.tarifa_original}) — {a.dias_dt || 1} dia{(a.dias_dt || 1) > 1 ? 's' : ''}</span>
                                      ) : a.tipo === 'baja' ? (
                                        <span><span style={{ color: '#dc2626', fontWeight: 600 }}>Baja:</span> {a.bus} (S/{a.tarifa_original})</span>
                                      ) : a.tipo === 'intercambio' ? (
                                        <span><span style={{ color: '#0891b2', fontWeight: 600 }}>Interc:</span> {a.placa_original} → {a.placa_nueva} (S/{a.tarifa_original} → S/{a.tarifa_nueva})</span>
                                      ) : a.tipo === 'rebaja' ? (
                                        <span><span style={{ color: '#059669', fontWeight: 600 }}>Rebaja:</span> {a.bus} (S/{a.tarifa_original} → S/{a.tarifa_nueva})</span>
                                      ) : (
                                        <span><span style={{ color: '#7c3aed', fontWeight: 600 }}>Unif:</span> {a.buses_origen?.join(', ')} → {a.placa_destino} (S/{a.tarifa_original} → S/{a.tarifa_nueva})</span>
                                      )}
                                    </div>
                                  )) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                                </td>
                                <td style={{ color: 'var(--text)' }}>
                                  {d.tarifa_total > 0 ? `S/${d.tarifa_total.toLocaleString(undefined, {minimumFractionDigits:2})}` : '—'}
                                </td>
                                <td style={{ fontWeight: 600, color: '#3b82f6' }}>
                                  {d.tarifa_optimizada > 0 ? `S/${d.tarifa_optimizada.toLocaleString(undefined, {minimumFractionDigits:2})}` : '—'}
                                </td>
                                <td style={{ fontWeight: 700, color: d.ahorro_dia > 0 ? '#059669' : 'var(--text-dim)' }}>
                                  S/{d.ahorro_dia.toLocaleString(undefined, {minimumFractionDigits:2})}
                                </td>
                                <td style={{ fontWeight: 800, color: '#059669', fontSize: 13 }}>
                                  S/{d.ahorro_acumulado.toLocaleString(undefined, {minimumFractionDigits:2})}
                                </td>
                                <td style={{ fontWeight: 600, color: '#f59e0b' }}>
                                  {d.soles_por_kg ? `$${(d.soles_por_kg / tipoCambio).toFixed(2)}` : '—'}
                                </td>
                                <td style={{ fontWeight: 600, color: '#38bdf8' }}>
                                  {d.kilos_export > 0 && d.tarifa_optimizada ? `$${((d.tarifa_optimizada / d.kilos_export) / tipoCambio).toFixed(2)}` : '—'}
                                </td>
                                <td style={{ fontWeight: 700, color: '#059669' }}>
                                  {d.kilos_export > 0 && d.tarifa_optimizada && d.soles_por_kg
                                    ? `$${((d.soles_por_kg / tipoCambio) - ((d.tarifa_optimizada / d.kilos_export) / tipoCambio)).toFixed(2)}`
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                            {(() => {
                              const totKilos = ahorrosSemanal.dias?.reduce((s, d) => s + (d.kilos_export || 0), 0) || 0;
                              const totSin = ahorrosSemanal.dias?.reduce((s, d) => s + (d.tarifa_total || 0), 0) || 0;
                              const totCon = ahorrosSemanal.dias?.reduce((s, d) => s + (d.tarifa_optimizada || 0), 0) || 0;
                              const totAhorro = ahorrosSemanal.dias?.reduce((s, d) => s + (d.ahorro_dia || 0), 0) || 0;
                              const totDkSin = ahorrosSemanal.dias?.reduce((s, d) => s + (d.soles_por_kg ? d.soles_por_kg / tipoCambio : 0), 0) || 0;
                              const totDkCon = ahorrosSemanal.dias?.reduce((s, d) => s + (d.kilos_export > 0 && d.tarifa_optimizada ? (d.tarifa_optimizada / d.kilos_export) / tipoCambio : 0), 0) || 0;
                              return (
                                <tr style={{ background: '#f1f5f9', fontWeight: 800, borderTop: '2px solid #94a3b8' }}>
                                  <td>TOTAL</td>
                                  <td style={{ color: '#6366f1' }}>{totKilos > 0 ? `${totKilos.toLocaleString(undefined, {maximumFractionDigits:0})} kg` : '—'}</td>
                                  <td colSpan={2}></td>
                                  <td>S/{totSin.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                                  <td style={{ color: '#3b82f6' }}>S/{totCon.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                                  <td style={{ color: '#059669' }}>S/{totAhorro.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                                  <td></td>
                                  <td style={{ color: '#f59e0b' }}>${totDkSin.toFixed(2)}</td>
                                  <td style={{ color: '#38bdf8' }}>${totDkCon.toFixed(2)}</td>
                                  <td style={{ color: '#059669' }}>${(totDkSin - totDkCon).toFixed(2)}</td>
                                </tr>
                              );
                            })()}
                          </tbody>
                        </table>
                      </div>

                      {/* Chart: Tarifa sin optimizar vs con optimizacion */}
                      {ahorrosSemanal.dias?.some(d => d.tiene_data) && (() => {
                        const diasConData = ahorrosSemanal.dias.filter(d => d.tiene_data);
                        const totalKilos = diasConData.reduce((s, d) => s + (d.kilos_export || 0), 0);
                        const totalTarifaReal = diasConData.reduce((s, d) => s + (d.tarifa_real_dia || d.tarifa_total || 0), 0);
                        const totalTarifaOpt = diasConData.reduce((s, d) => s + (d.tarifa_optimizada || 0), 0);
                        const dolarKgTotal = totalKilos > 0 ? (totalTarifaReal / totalKilos) / tipoCambio : 0;
                        const sumDolarKg = diasConData.reduce((s, d) => s + (d.soles_por_kg ? d.soles_por_kg / tipoCambio : 0), 0);
                        const sumDolarKgOpt = diasConData.reduce((s, d) => s + (d.kilos_export > 0 ? (d.tarifa_optimizada / d.kilos_export) / tipoCambio : 0), 0);
                        const maxDailyDk = Math.max(...diasConData.map(d => d.soles_por_kg ? d.soles_por_kg / tipoCambio : 0));
                        const rightMax = Math.round(maxDailyDk * 150) / 100;
                        const getSemanaISO = (fechaStr) => {
                          if (!fechaStr) return '';
                          const d = new Date(fechaStr + 'T00:00:00');
                          const target = new Date(d.valueOf());
                          const dayNr = (d.getDay() + 6) % 7;
                          target.setDate(target.getDate() - dayNr + 3);
                          const firstThursday = new Date(target.getFullYear(), 0, 4);
                          const diff = target - firstThursday;
                          return 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
                        };
                        const chartData = [
                          ...diasConData.map(d => ({
                            dia: d.dia,
                            semana: d.fecha ? `Sem ${getSemanaISO(d.fecha)}` : '',
                            sinOpt: d.tarifa_total,
                            conOpt: d.tarifa_optimizada,
                            diff: Math.max(0, d.tarifa_total - d.tarifa_optimizada),
                            dt: d.tarifa_dt || 0,
                            dolarKg: d.soles_por_kg ? d.soles_por_kg / tipoCambio : 0,
                            dolarKgOpt: d.kilos_export > 0 ? (d.tarifa_optimizada / d.kilos_export) / tipoCambio : 0,
                          })),
                          { dia: 'Total', semana: '', sinOpt: 0, conOpt: 0, diff: 0, dolarKgBar: sumDolarKg, dolarKgOptBar: sumDolarKgOpt, dolarKgProm: totalKilos > 0 ? (totalTarifaReal / totalKilos) / tipoCambio : 0 },
                        ];
                        const DiaSemanaTick = ({ x, y, payload, index }) => {
                          const entry = chartData[index];
                          const sem = entry?.semana || '';
                          return (
                            <g transform={`translate(${x},${y})`}>
                              <text x={0} y={0} dy={14} textAnchor="middle" fontSize={12} fontWeight={600} fill="#334155">{payload.value}</text>
                              {sem && <text x={0} y={0} dy={28} textAnchor="middle" fontSize={10} fontWeight={500} fill="#94a3b8">{sem}</text>}
                            </g>
                          );
                        };
                        const fmtK = v => Math.round(v).toLocaleString();
                        const CustomLabel = ({ x, y, width, height, value }) => {
                          if (!value) return null;
                          const cx = x + width / 2;
                          if (height < 50) {
                            return <text x={cx} y={y - 6} textAnchor="start" fontSize={8} fontWeight={600} fill="#374151" transform={`rotate(-90, ${cx}, ${y - 6})`}>S/.{fmtK(value)}</text>;
                          }
                          const cy = y + height / 2;
                          return <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={700} fill="#fff" transform={`rotate(-90, ${cx}, ${cy})`}>S/.{fmtK(value)}</text>;
                        };
                        const DiffLabel = (props) => {
                          const { x, y, width, index } = props;
                          const d = chartData[index];
                          if (!d) return null;
                          if (d.diff === 0) return (
                            <text x={x + width / 2} y={y - 8} textAnchor="middle" fontSize={11} fontWeight={700} fill="#9ca3af">S/0</text>
                          );
                          const isPos = d.diff > 0;
                          return (
                            <text x={x + width / 2} y={y - 8} textAnchor="middle" fontSize={11} fontWeight={700} fill={isPos ? '#16a34a' : '#dc2626'}>
                              +{fmtK(Math.abs(d.diff))} ↑
                            </text>
                          );
                        };
                        return (
                        <div style={{ marginTop: 24 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <h4 style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                              <i className="fa-solid fa-chart-column" style={{ marginRight: 6 }} />
                              Comparativo de Tarifa Semanal
                            </h4>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#6b7280' }}>
                              <span>T.C: <strong style={{ color: 'var(--text)' }}>{tipoCambio.toFixed(2)}</strong></span>
                            </div>
                          </div>
                          <ResponsiveContainer width="100%" height={400}>
                            <ComposedChart data={chartData} barGap={2} barCategoryGap="25%" margin={{ top: 15, right: 50, left: 10, bottom: 20 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                              <XAxis dataKey="dia" tick={<DiaSemanaTick />} axisLine={false} tickLine={false} interval={0} height={45} />
                              <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={v => `S/${fmtK(v)}`} axisLine={false} tickLine={false} />
                              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => `$${v.toFixed(2)}`} axisLine={false} tickLine={false} domain={[0, rightMax]} />
                              <YAxis yAxisId="rightBar" orientation="right" hide={true} />
                              <RTooltip
                                formatter={(v, name) => {
                                  if (name === 'dolarKg') return [`$${v.toFixed(4)}`, '$/kg sin opt'];
                                  if (name === 'dolarKgOpt') return [`$${v.toFixed(4)}`, '$/kg con opt'];
                                  if (name === 'dolarKgBar') return [`$${v.toFixed(4)}`, 'Sum $/kg sin opt'];
                                  if (name === 'dolarKgOptBar') return [`$${v.toFixed(4)}`, 'Sum $/kg con opt'];
                                  if (name === 'dolarKgProm') return [`$${v.toFixed(2)}`, '$/kg (Tarifa/Kilos)'];
                                  return [`S/${v.toLocaleString(undefined, {minimumFractionDigits:2})}`, name === 'sinOpt' ? 'Sin optimizar' : name === 'conOpt' ? 'Con optimizacion' : name === 'dt' ? 'DT' : 'Ahorro'];
                                }}
                                labelFormatter={l => l}
                                contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid var(--border)' }}
                              />
                              <Legend formatter={v => v === 'sinOpt' ? 'Sin optimizar' : v === 'conOpt' ? 'Con optimizacion' : v === 'dt' ? 'DT' : v === 'dolarKg' ? '$/kg sin opt' : v === 'dolarKgOpt' ? '$/kg con opt' : v === 'dolarKgBar' ? 'Sum $/kg sin opt' : v === 'dolarKgOptBar' ? 'Sum $/kg con opt' : v === 'dolarKgProm' ? '$/kg (Tarifa/Kilos)' : 'Ahorro'} wrapperStyle={{ fontSize: 12 }} />
                              <Bar yAxisId="left" dataKey="sinOpt" fill="#ef4444" radius={[6,6,0,0]} label={<CustomLabel fill="#ef4444" />} />
                              <Bar yAxisId="left" dataKey="conOpt" fill="#3b82f6" radius={[6,6,0,0]} label={<CustomLabel fill="#3b82f6" />} />
                              <Bar yAxisId="left" dataKey="diff" fill="#22c55e" radius={[6,6,0,0]} label={<CustomLabel fill="#22c55e" />} />
                              <Bar yAxisId="left" dataKey="dt" fill="#4338ca" radius={[6,6,0,0]} label={<CustomLabel fill="#4338ca" />} />
                              <Line yAxisId="right" type="monotone" dataKey="dolarKg" stroke="#f59e0b" strokeWidth={2} dot={{ r: 5, fill: '#f59e0b' }} label={{ fontSize: 10, fontWeight: 700, fill: '#f59e0b', formatter: v => v ? `$${v.toFixed(2)}` : '', position: 'top' }} connectNulls={false} />
                              <Line yAxisId="right" type="monotone" dataKey="dolarKgOpt" stroke="#38bdf8" strokeWidth={2} dot={{ r: 5, fill: '#38bdf8' }} label={{ fontSize: 10, fontWeight: 700, fill: '#38bdf8', formatter: v => v ? `$${v.toFixed(2)}` : '', position: 'bottom' }} connectNulls={false} />
                              <Bar yAxisId="rightBar" dataKey="dolarKgBar" fill="#f59e0b" radius={[6,6,0,0]} label={({ x, y, width, height, value }) => {
                                if (!value) return null;
                                const cx = x + width / 2;
                                const cy = y + height / 2;
                                return <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={700} fill="#fff" transform={`rotate(-90, ${cx}, ${cy})`}>${value.toFixed(2)}</text>;
                              }} />
                              <Bar yAxisId="rightBar" dataKey="dolarKgOptBar" fill="#38bdf8" radius={[6,6,0,0]} label={({ x, y, width, height, value }) => {
                                if (!value) return null;
                                const cx = x + width / 2;
                                const cy = y + height / 2;
                                return <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={700} fill="#fff" transform={`rotate(-90, ${cx}, ${cy})`}>${value.toFixed(2)}</text>;
                              }} />
                              <Bar yAxisId="rightBar" dataKey="dolarKgProm" fill="#9333ea" radius={[6,6,0,0]} label={({ x, y, width, height, value }) => {
                                if (!value) return null;
                                const cx = x + width / 2;
                                const cy = y + height / 2;
                                return <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={700} fill="#fff" transform={`rotate(-90, ${cx}, ${cy})`}>${value.toFixed(2)}</text>;
                              }} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                        );
                      })()}

                    </div>
                  )}
                </div>
              )}
            </section>
          </>;
        })()}

        {activeTab === 'indicadores' && (
          <section style={{ padding: '0 8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
              <h2 style={{ margin: 0 }}><i className="fa-solid fa-chart-line" style={{ marginRight: 8 }} />Indicadores Mensuales</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <select value={indicadorMes} onChange={e => { setIndicadorMes(e.target.value); loadIndicadores(e.target.value); }} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>
                  {mesesDisponibles.length > 0 ? mesesDisponibles.map(m => {
                    const [y, mo] = m.split('-');
                    const label = new Date(y, parseInt(mo) - 1).toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
                    return <option key={m} value={m}>{label.charAt(0).toUpperCase() + label.slice(1)}</option>;
                  }) : <option value="">Cargando...</option>}
                </select>
                <button onClick={() => loadIndicadores(indicadorMes)} disabled={indicadorLoading} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  {indicadorLoading ? <><span className="spinner" style={{ marginRight: 6 }} />Cargando...</> : <><i className="fa-solid fa-rotate-right" style={{ marginRight: 4 }} />Actualizar</>}
                </button>
              </div>
            </div>

            {indicadorLoading && !indicadorData && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}><span className="spinner" style={{ marginRight: 8 }} />Cargando indicadores del mes...</div>
            )}

            {indicadorData?.totales && (() => {
              const t = indicadorData.totales;
              const dias = indicadorData.dias || [];
              const ahorro = t.tarifa - t.gasto_optimo;
              const pctAhorro = t.tarifa > 0 ? (ahorro / t.tarifa * 100) : 0;

              const chartData = dias.map(d => {
                const dt = new Date(d.fecha + 'T12:00:00');
                return { ...d, dia: dt.getDate(), label: dt.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' }) };
              });

              const vaciosProm = t.vacios_prom_bus || 0;

              const customTooltip = ({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{payload[0]?.payload?.label || label}</div>
                    {payload.map((p, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 2 }}>
                        <span style={{ color: p.color }}>{p.name}</span>
                        <span style={{ fontWeight: 600 }}>S/{formatNum(Math.round(p.value))}</span>
                      </div>
                    ))}
                  </div>
                );
              };

              const ocupTooltip = ({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{d?.label}</div>
                    <div>Ocupación: <strong>{d?.ocupacion}%</strong></div>
                    <div>Buses: <strong>{d?.buses}</strong></div>
                    <div>Pasajeros: <strong>{formatNum(d?.pasajeros)}</strong></div>
                  </div>
                );
              };

              return <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 24 }}>
                  <div style={{ padding: '20px 24px', borderRadius: 12, background: 'var(--bg-card)', border: '1.5px solid #ef444430', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: '#ef4444' }} />
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Gasto sin optimizar</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)' }}>S/{formatNum(Math.round(t.gasto_sin_opt))}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Tarifa + pérdida por vacíos — {t.dias_operados} días</div>
                  </div>
                  <div style={{ padding: '20px 24px', borderRadius: 12, background: 'var(--bg-card)', border: '1.5px solid #3b82f630', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: '#3b82f6' }} />
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Gasto actual</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)' }}>S/{formatNum(Math.round(t.tarifa))}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>~{t.buses_prom} buses/día — {t.ocupacion_prom}% ocup. promedio</div>
                  </div>
                  <div style={{ padding: '20px 24px', borderRadius: 12, background: 'var(--bg-card)', border: '1.5px solid #16a34a30', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: '#16a34a' }} />
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Gasto óptimo</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)' }}>S/{formatNum(Math.round(t.gasto_optimo))}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Si todos los buses operaran a capacidad</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
                  <div style={{ padding: '16px 20px', borderRadius: 10, background: 'var(--bg-card)', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 4 }}>Ahorro potencial</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#16a34a' }}>S/{formatNum(Math.round(ahorro))}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{pctAhorro.toFixed(1)}% del gasto actual</div>
                  </div>
                  <div style={{ padding: '16px 20px', borderRadius: 10, background: 'var(--bg-card)', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 4 }}>Días operados</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#3b82f6' }}>{t.dias_operados}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>~{t.buses_prom} buses promedio/día</div>
                  </div>
                  <div style={{ padding: '16px 20px', borderRadius: 10, background: 'var(--bg-card)', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 4 }}>% Vacíos prom. por bus</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#ef4444' }}>{vaciosProm}%</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Promedio normalizado por capacidad</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 20, marginBottom: 28 }}>
                  <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: '20px 16px', border: '1px solid var(--border)' }}>
                    <h3 style={{ margin: '0 0 16px 8px', fontSize: 14 }}><i className="fa-solid fa-chart-column" style={{ marginRight: 6, color: '#3b82f6' }} />Gasto diario vs Pérdida</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                        <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                        <RTooltip content={customTooltip} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="tarifa" name="Gasto" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={16} />
                        <Bar dataKey="gasto_optimo" name="Gasto Óptimo" fill="#16a34a" radius={[4, 4, 0, 0]} barSize={16} opacity={0.8} />
                        <Line dataKey="perdida" name="Ahorro" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: '#ef4444', strokeWidth: 0 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: '20px 16px', border: '1px solid var(--border)' }}>
                    <h3 style={{ margin: '0 0 16px 8px', fontSize: 14 }}><i className="fa-solid fa-chart-area" style={{ marginRight: 6, color: '#8b5cf6' }} />Ocupación diaria (%)</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <defs>
                          <linearGradient id="gradOcup" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                        <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `${v}%`} />
                        <RTooltip content={ocupTooltip} />
                        <Area dataKey="ocupacion" name="Ocupación" stroke="#8b5cf6" strokeWidth={2.5} fill="url(#gradOcup)" dot={{ r: 3, fill: '#8b5cf6', strokeWidth: 0 }} activeDot={{ r: 5, fill: '#8b5cf6' }} />
                        <Line dataKey={() => 90} name="Meta 90%" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 4" dot={false} legendType="none" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

              </>;
            })()}

            {indicadorData && !indicadorData.totales && !indicadorLoading && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
                <i className="fa-solid fa-calendar-xmark" style={{ fontSize: 36, marginBottom: 12 }} />
                <p>No hay datos para este mes</p>
              </div>
            )}
          </section>
        )}

        {activeTab === 'transporte' && (
          <>
            {rutasData && <RouteMap rutasData={rutasData} onDistancesReady={setRouteDistances} />}

            {routeDistances && <FuelEstimator routeDistances={routeDistances} cruce={cruce} facilito={facilito} />}

            <section className="facilito-section">
          <h2><i className="fa-solid fa-gas-pump" style={{marginRight: 6}} /> Precios de Combustible (Facilito - OSINERGMIN)</h2>
          <p className="muted" style={{ marginBottom: 12 }}>La Libertad + Lambayeque — datos actualizados desde Facilito</p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
            <button onClick={startFacilito} disabled={facilitoLoading} className="btn btn-primary">
              {facilitoLoading ? <><span className="spinner" style={{ marginRight: 8 }} /> Scrapeando...</> : <><i className="fa-solid fa-rotate-right" style={{marginRight: 6}} /> Actualizar Precios</>}
            </button>
            {facilito.length > 0 && <span className="badge badge-ok">{formatNum(facilito.length)} registros</span>}
          </div>
          {facilitoProgress && (
            <div className="sp-progress" style={{ marginBottom: 16, maxWidth: 500 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                <span className="spinner" /> {facilitoProgress.step}
              </div>
              <div className="progress-bar-track"><div className="progress-bar-fill" style={{ width: `${facilitoProgress.pct}%` }} /></div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>{facilitoProgress.pct}%</div>
            </div>
          )}
          {facilito.length > 0 && (
            <>
              <div className="filters-row" style={{ marginBottom: 12 }}>
                <select value={facilitoFilter.dep} onChange={e => setFacilitoFilter(f => ({ ...f, dep: e.target.value, prov: '' }))}>
                  <option value="">Todos los Deptos</option>
                  {facilitoDeps.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <select value={facilitoFilter.prov} onChange={e => setFacilitoFilter(f => ({ ...f, prov: e.target.value }))}>
                  <option value="">Todas las Provincias</option>
                  {facilitoProvs.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select value={facilitoFilter.prod} onChange={e => setFacilitoFilter(f => ({ ...f, prod: e.target.value }))}>
                  <option value="">Todos los Productos</option>
                  {facilitoProds.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="ag-theme-alpine grid-container">
                <AgGridReact rowData={filteredFacilito} columnDefs={facilitoColumns}
                  defaultColDef={{ resizable: true, sortable: true, filter: true }}
                  domLayout="autoHeight" pagination paginationPageSize={20} animateRows />
              </div>
            </>
          )}
            </section>
          </>
        )}


        {activeTab === 'bajas' && (
          <section style={{ padding: '0 8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
              <h2 style={{ margin: 0 }}><i className="fa-solid fa-user-minus" style={{ marginRight: 8 }} />Novedades de Personal</h2>
            </div>

            {/* Formulario para agregar novedad */}
            <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 20, border: '1px solid var(--border)', marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 14 }}><i className="fa-solid fa-plus-circle" style={{ color: '#3b82f6', marginRight: 8 }} />Agregar Novedad</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>Fecha</label>
                  <input type="date" value={novedadForm.fecha} onChange={e => setNovedadForm({ ...novedadForm, fecha: e.target.value })} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>Zona</label>
                  <input value={novedadForm.zona} onChange={e => setNovedadForm({ ...novedadForm, zona: e.target.value })} placeholder="Zona" style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, width: 120 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>DNI</label>
                  <input value={novedadForm.dni} onChange={e => setNovedadForm({ ...novedadForm, dni: e.target.value })} placeholder="DNI" style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, width: 100 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>Nombres y Apellidos</label>
                  <input value={novedadForm.nombre} onChange={e => setNovedadForm({ ...novedadForm, nombre: e.target.value })} placeholder="Nombre completo" style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, width: 200 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>Motivo</label>
                  <input value={novedadForm.motivo} onChange={e => setNovedadForm({ ...novedadForm, motivo: e.target.value })} placeholder="Motivo" style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, width: 160 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>Tipo</label>
                  <select value={novedadForm.tipo} onChange={e => setNovedadForm({ ...novedadForm, tipo: e.target.value })} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12 }}>
                    <option value="contar">Contar</option>
                    <option value="no_contar">No contar</option>
                  </select>
                </div>
                <button onClick={guardarNovedad} className="btn btn-primary" style={{ fontSize: 12, padding: '6px 16px', background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                  <i className="fa-solid fa-plus" style={{ marginRight: 4 }} />Agregar
                </button>
                <button onClick={() => loadNovedades(novedadForm.fecha)} className="btn" style={{ fontSize: 12, padding: '6px 16px', background: '#f3f4f6', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>
                  <i className="fa-solid fa-search" style={{ marginRight: 4 }} />Buscar
                </button>
              </div>
            </div>

            {/* Info */}
            <div style={{ background: '#eff6ff', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: '#1e40af', border: '1px solid #bfdbfe' }}>
              <i className="fa-solid fa-info-circle" style={{ marginRight: 6 }} />
              <strong>Contar:</strong> falta temporal (hoy no viene, manana si). <strong>No contar:</strong> baja permanente (no se cuenta de esa fecha en adelante en el algoritmo).
            </div>

            {/* Tabla de novedades */}
            <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>
                <i className="fa-solid fa-list" style={{ color: '#6b7280', marginRight: 8 }} />
                Novedades {novedadForm.fecha && `del ${novedadForm.fecha}`} ({novedades.length})
              </h3>
              {novedades.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 20, fontSize: 13 }}>
                  No hay novedades registradas. Selecciona una fecha y presiona "Buscar", o agrega una nueva.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="mini-table" style={{ width: '100%', fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Zona</th>
                        <th>DNI</th>
                        <th>Nombres y Apellidos</th>
                        <th>Motivo</th>
                        <th>Tipo</th>
                        <th style={{ width: 60 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {novedades.map(nov => (
                        <tr key={nov.id}>
                          <td>{nov.fecha}</td>
                          <td>{nov.zona || '-'}</td>
                          <td style={{ fontFamily: 'var(--mono)' }}>{nov.dni}</td>
                          <td>{nov.nombre || '-'}</td>
                          <td>{nov.motivo || '-'}</td>
                          <td>
                            <button onClick={() => toggleNovedadTipo(nov)} style={{
                              padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                              background: nov.tipo === 'contar' ? '#dcfce7' : '#fee2e2',
                              color: nov.tipo === 'contar' ? '#16a34a' : '#dc2626',
                            }}>
                              {nov.tipo === 'contar' ? 'CONTAR' : 'NO CONTAR'}
                            </button>
                          </td>
                          <td>
                            <button onClick={() => eliminarNovedad(nov.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>
                              <i className="fa-solid fa-trash" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Carga masiva de novedades */}
            <div style={{ marginTop: 20, background: 'var(--bg-card)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 14 }}><i className="fa-solid fa-file-excel" style={{ color: '#16a34a', marginRight: 8 }} />Carga Masiva (Excel)</h3>
                <button onClick={() => {
                  const a = document.createElement('a'); a.href = '/api/novedades/plantilla'; a.download = 'plantilla_novedades.xlsx'; a.click();
                }} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #16a34a', background: '#f0fdf4', color: '#16a34a', fontWeight: 600, cursor: 'pointer' }}>
                  <i className="fa-solid fa-download" style={{ marginRight: 4 }} />Descargar Plantilla
                </button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 8px' }}>Sube un Excel con columnas: <strong>Fecha, Zona, DNI, Nombre, Motivo, Tipo</strong> (contar / no_contar)</p>
              <input type="file" accept=".xlsx,.xls" onChange={e => { if (e.target.files[0]) uploadNovedadesMasivo(e.target.files[0]); }} disabled={novedadesUploading} style={{ fontSize: 12 }} />
              {novedadesUploading && <div style={{ textAlign: 'center', padding: 12, color: 'var(--text-dim)' }}><span className="spinner" style={{ marginRight: 8 }} />Cargando...</div>}
              {novedadesMsg && <div style={{ padding: '8px 12px', borderRadius: 6, marginTop: 8, background: novedadesMsg.startsWith('Error') ? '#fef2f2' : '#f0fdf4', color: novedadesMsg.startsWith('Error') ? '#dc2626' : '#16a34a', fontSize: 12, fontWeight: 600 }}>{novedadesMsg}</div>}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
