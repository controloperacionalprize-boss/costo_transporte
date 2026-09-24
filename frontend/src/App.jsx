import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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
  'LICAPA': 'LOCAL', 'CHUIN': 'LOCAL', 'PUERTO MALABRIGO': 'LOCAL', 'ROMA': 'LOCAL', 'SANTIAGO DE CAO': 'LOCAL', 'SAUSAL': 'LOCAL',
  'CIUDAD DE DIOS': 'NORTE', 'GUADALUPE': 'NORTE', 'PACANGUILLA': 'NORTE', 'PACASMAYO': 'NORTE', 'VERDÚN': 'NORTE', 'VERDUN': 'NORTE',
  'JEQUETEPEQUE': 'NORTE', 'CHEQUÉN': 'NORTE', 'CHEQUEN': 'NORTE', 'SEMAN': 'NORTE',
  'TRUJILLO': 'SUR', 'ALTO TRUJILLO': 'SUR', 'LA ESPERANZA': 'SUR', 'LAREDO': 'SUR', 'PORVENIR': 'SUR',
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

// ─── Sidebar ───────────────────────────────────────────────────────────────
function Sidebar({ dbStatus, setDbStatus, onDataLoaded, activeTab, setActiveTab, empresa }) {
  const [dbLoading, setDbLoading] = useState(false);
  const [dbProgress, setDbProgress] = useState(null);

  const [fecha, setFecha] = useState('');
  const [empresaLocal, setEmpresaLocal] = useState('');
  const [empresas, setEmpresas] = useState([]);
  const [fechasDisp, setFechasDisp] = useState([]);

  const autoLoaded = useRef(false);

  useEffect(() => {
    api('/api/db/filters').then(d => {
      setEmpresas(d.empresas || []);
      setFechasDisp(d.fechas || []);
      if (d.fechas?.length) setFecha(d.fechas[0]);
      return d;
    }).then(d => {
      if (!autoLoaded.current && d.fechas?.length) {
        autoLoaded.current = true;
        const f = d.fechas[0];
        setTimeout(() => loadFromDB({ fecha: f, empresa: '' }), 100);
      }
    }).catch(() => {});
  }, []);

  const loadFromDB = async (overrides = {}) => {
    const f = overrides.fecha ?? fecha;
    const emp = overrides.empresa ?? empresaLocal;
    setDbLoading(true);
    setDbProgress({ step: 'Conectando...', pct: 0 });
    try {
      await api('/api/db/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: SESSION_ID, fecha: f, empresa: emp }),
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
            if (s.viajes_loaded && s.asistencia_loaded) onDataLoaded();
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
                <button key={f} onClick={() => { setFecha(f); loadFromDB({ fecha: f }); }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, border: isSelected ? '1.5px solid #3b82f6' : '1px solid transparent', background: isSelected ? '#3b82f620' : 'rgba(255,255,255,0.05)', color: isSelected ? '#60a5fa' : 'var(--sidebar-text, #cbd5e1)', cursor: 'pointer', transition: 'all .15s', fontSize: 12, textAlign: 'left' }}>
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
        <select value={empresaLocal} onChange={e => setEmpresaLocal(e.target.value)} style={{ width: '100%', marginBottom: 12 }}>
          <option value="">Todas</option>
          {empresas.map(e => <option key={e} value={e}>{e}</option>)}
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
  const [selCeco, setSelCeco] = useState('');
  const [selZona, setSelZona] = useState('');
  const [selPlaca, setSelPlaca] = useState('');
  const [searchPlaca, setSearchPlaca] = useState('');
  const [detailPlaca, setDetailPlaca] = useState('');
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [umbral, setUmbral] = useState(70);
  const [rebalanceo, setRebalanceo] = useState(null);
  const [rebalLoading, setRebalLoading] = useState(false);
  const [rebalOpen, setRebalOpen] = useState({});
  const [rutasData, setRutasData] = useState(null);
  const [routeDistances, setRouteDistances] = useState(null);

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

  const runProcess = async () => {
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
  };

  const filteredCruce = useMemo(() => {
    return cruce.filter(r => {
      if (selCeco && r.CECO !== selCeco) return false;
      if (selZona && r.ZONA_PROCEDENCIA !== selZona) return false;
      if (selPlaca && r.PLACA !== selPlaca) return false;
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
    const visibleCols = ['BUS', 'T_BUS', 'PROVEEDOR','CAPACIDAD', 'RUTA', 'ZONA_PROCEDENCIA', 'TARIFA', 'PAS_REAL', 'PORCENTAJE_OCUP', 'ASIENTOS_VACIOS', 'COSTO_PASAJERO', 'COSTO_KM', 'PERDIDA'];
    const headerNames = {'BUS':'Bus','T_BUS':'T. Bus','PROVEEDOR':'Proveedor','CAPACIDAD':'Cap.','RUTA':'Ruta','ZONA_PROCEDENCIA':'Zona','TARIFA':'Tarifa','PAS_REAL':'Pas. Real','PORCENTAJE_OCUP':'% Ocup.','ASIENTOS_VACIOS':'Vacío','COSTO_PASAJERO':'Costo/Pas','COSTO_KM':'S//Km','PERDIDA':'Pérdida'};
    const cols = visibleCols.filter(k => k === 'COSTO_KM' || cruce[0]?.[k] !== undefined).map(k => {
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
    });
    return cols;
  }, [cruce, routeDistances]);

  const detailColumns = useMemo(() => [
    { headerName: 'DNI', valueGetter: p => p.data?.['DNI PASA.'], sortable: true, filter: true, width: 120 },
    { field: 'PASAJERO', sortable: true, filter: true, flex: 1, minWidth: 200 },
    { field: 'cargo', headerName: 'Cargo', sortable: true, filter: true, width: 180 },
    { field: 'area', headerName: 'Área', sortable: true, filter: true, width: 160 },
    { field: 'ACTIVIDAD', sortable: true, filter: true, width: 140 },
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
  ], []);

  const runRebalanceo = async () => {
    setRebalLoading(true);
    try {
      const [res, rutas] = await Promise.all([
        api('/api/rebalanceo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: SESSION_ID, umbral }),
        }),
        api(`/api/rutas-mapa?session_id=${SESSION_ID}`),
      ]);
      setRebalanceo(res);
      setRutasData(rutas);
    } catch (e) { alert('Error en rebalanceo: ' + e.message); }
    setRebalLoading(false);
  };

  const toggleRebal = (idx) => setRebalOpen(prev => ({ ...prev, [idx]: !prev[idx] }));

  const empresaName = dbStatus?.empresa || '';

  return (
    <div className="app-layout">
      <Sidebar
        dbStatus={dbStatus} setDbStatus={setDbStatus}
        activeTab={activeTab} setActiveTab={setActiveTab}
        empresa={empresaName}
        onDataLoaded={() => {
          setCruce([]); setPersonas([]); setMetrics(null); setRebalanceo(null);
          setRutasData(null); setRouteDistances(null); setDetailPlaca(''); runProcess();
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

        {!(viajesFromDb && asistFromDb) && (
          <section className="upload-section">
            {!viajesFromDb && (
              <Dropzone icon={<i className="fa-solid fa-file-excel" />} label="Viajes Realizados" hint="Puedes subir 1 o 2 archivos (.xlsx)" multiple onFiles={uploadViajes} fileNames={viajesFiles.map(f => f.name)} />
            )}
            {!asistFromDb && (
              <Dropzone icon={<i className="fa-solid fa-users" />} label="Registro Asistencia" hint="Un archivo (.xlsx)" multiple={false} onFiles={uploadAsistencia} fileNames={asistenciaFile ? [asistenciaFile.name] : []} />
            )}
          </section>
        )}

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
          </section>
        )}

        {activeTab === 'cosecha' && cruce.length > 0 && (() => {
          const sectorStats = {};
          filteredCruce.forEach(r => {
            const zona = (r.ZONA_PROCEDENCIA || '').toUpperCase().trim();
            const sector = ZONA_A_SECTOR[zona] || 'OTROS';
            if (!sectorStats[sector]) sectorStats[sector] = { buses: 0, capacidad: 0, pasajeros: 0 };
            sectorStats[sector].buses += 1;
            sectorStats[sector].capacidad += (r.CAPACIDAD || 0);
            sectorStats[sector].pasajeros += (r.PAS_REAL || 0);
          });
          const sectores = Object.entries(sectorStats).sort((a, b) => b[1].capacidad - a[1].capacidad);
          return <>
            <section style={{ marginBottom: 0 }}>
              <h2 style={{ marginBottom: 12 }}><i className="fa-solid fa-layer-group" style={{ marginRight: 6 }} />Capacidad por Zona</h2>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
                {sectores.map(([sector, s]) => {
                  const pct = s.capacidad > 0 ? Math.round(s.pasajeros / s.capacidad * 100) : 0;
                  const color = SECTOR_COLORS[sector] || '#6b7280';
                  return (
                    <div key={sector} style={{ flex: '1 1 160px', maxWidth: 220, padding: '12px 16px', borderRadius: 10, background: 'var(--bg-card, #fff)', border: `1.5px solid ${color}30`, position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: '#e5e7eb' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width .3s' }} />
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{sector}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{s.pasajeros}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-dim)' }}>/{s.capacidad}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{s.buses} buses</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: pct >= 80 ? 'var(--green)' : pct >= 50 ? '#ca8a04' : 'var(--red)' }}>{pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section>
              <h2>Cruce de Datos</h2>
              <div className="filters-row">
                <select value={selCeco} onChange={e => setSelCeco(e.target.value)}>
                  <option value="">Todas las CCE/Com.</option>
                  {filters.cecos.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={selZona} onChange={e => setSelZona(e.target.value)}>
                  <option value="">Todas las Zonas</option>
                  {filters.zonas.map(z => <option key={z} value={z}>{z}</option>)}
                </select>
                <select value={selPlaca} onChange={e => setSelPlaca(e.target.value)}>
                  <option value="">Todos los Pasos</option>
                  {filters.placas.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
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
                  rowData={filteredCruce}
                  columnDefs={cruceColumns}
                  defaultColDef={{ resizable: true, sortable: true, filter: true }}
                  domLayout="autoHeight"
                  pagination
                  paginationPageSize={20}
                  animateRows
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
                      <div><b>Real:</b> {detailPersons.length}</div>
                      <div><b>% Ocup:</b> {detailBusInfo.PORCENTAJE_OCUP ?? '—'}%</div>
                      <div><b>Tarifa:</b> S/{detailBusInfo.TARIFA?.toLocaleString() ?? '—'}</div>
                    </div>
                  )}
                  {detailPersons.length > 0 ? (
                    <div className="ag-theme-alpine" style={{ width: '100%' }}>
                      <AgGridReact rowData={detailPersons} columnDefs={detailColumns}
                        defaultColDef={{ resizable: true, sortable: true }} domLayout="autoHeight" animateRows />
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
                  <strong>{umbral}%</strong>
                  <input type="range" min={30} max={90} step={5} value={umbral} onChange={e => setUmbral(+e.target.value)} />
                </label>
                <button onClick={runRebalanceo} disabled={rebalLoading} className="btn btn-primary">
                  {rebalLoading ? <><span className="spinner" style={{ marginRight: 8 }} /> Calculando...</> : 'Calcular Rebalanceo'}
                </button>
              </div>

              {rebalanceo?.resumen && (
                <div className="rebal-summary">
                  <MetricCard title="Buses eliminables" value={rebalanceo.resumen.buses_eliminables} color="red" icon={<i className="fa-solid fa-ban" />} />
                  <MetricCard title="Personas reasignadas" value={rebalanceo.resumen.personas_reasignables} color="yellow" icon={<i className="fa-solid fa-people-arrows" />} />
                  <MetricCard title="Sin espacio" value={rebalanceo.resumen.sin_espacio} color="red" icon={<i className="fa-solid fa-triangle-exclamation" />} />
                  <MetricCard title="Pérdida total" value={`S/${(rebalanceo.recomendaciones?.reduce((sum, r) => sum + (r.perdida || 0), 0) || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`} color="red" icon={<i className="fa-solid fa-money-bill-wave" />} />
                </div>
              )}

              {rutasData && <RouteMap rutasData={rutasData} onDistancesReady={setRouteDistances} />}

              {rebalanceo?.recomendaciones?.map((rec, idx) => (
                <div key={idx} className={`rebal-card ${rebalOpen[idx] ? 'open' : ''}`}>
                  <div className="rebal-card-header" onClick={() => toggleRebal(idx)}>
                    <span className="rebal-placa">{rec.placa || rec.placa_origen || rec.bus}</span>
                    <span className="rebal-info">
                      {rec.zona && <span className="badge" style={{marginRight:6}}>{rec.zona}</span>}
                      {rec.ruta || rec.tipo || ''} &nbsp;|&nbsp; {rec.pasajeros ?? '?'}/{rec.capacidad ?? '?'}
                      &nbsp;|&nbsp; Tarifa: S/{rec.tarifa?.toLocaleString() ?? '?'}
                      &nbsp;|&nbsp; Costo/Pas: S/{rec.costo_pasajero?.toFixed(2) ?? '?'}
                      &nbsp;|&nbsp; <span style={{color:'var(--red)', fontWeight:700}}>Pérdida: S/{rec.perdida?.toLocaleString() ?? '?'}</span>
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
                              <tr><th>DNI</th><th>Pasajero</th><th>Actividad</th><th>Jarras/Sem</th><th>Bus Destino</th><th>Zona Destino</th><th>Tipo</th><th>CECO Destino</th></tr>
                            </thead>
                            <tbody>
                              {(rec.asignaciones || rec.personas_reasignables || []).map((p, i) => (
                                <tr key={i}>
                                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{p.DNI || p.dni}</td>
                                  <td>{p.PASAJERO || p.pasajero || p.nombre}</td>
                                  <td>{p.ACTIVIDAD || p.actividad || '-'}</td>
                                  <td style={{ fontFamily: 'var(--mono)', color: (p.PROM_JARRAS_SEM || p.rendimiento || 0) >= 50 ? 'var(--green)' : 'inherit' }}>
                                    {p.PROM_JARRAS_SEM ?? p.rendimiento ?? '-'}
                                  </td>
                                  <td style={{ fontFamily: 'var(--mono)' }}>{p.BUS_DESTINO || p.destino || '-'}</td>
                                  <td>{p.ZONA_DESTINO || '-'}</td>
                                  <td style={{ fontSize: 11, color: p.TIPO_REASIGNACION === 'parada_en_ruta' ? '#b45309' : '#166534' }}>
                                    {p.TIPO_REASIGNACION === 'parada_en_ruta' ? 'Parada en ruta' : p.TIPO_REASIGNACION === 'misma_zona' ? 'Misma zona' : '-'}
                                  </td>
                                  <td>{p.CECO_DESTINO || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </section>
          </>;
        })()}

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
      </main>
    </div>
  );
}
