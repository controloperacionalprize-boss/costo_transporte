# Control Operacional - Transporte Cosecha

Sistema para optimizar el transporte de personal a campos de cosecha. Cruza datos de viajes, asistencia, jarras (rendimiento) y horas para detectar buses subutilizados y proponer rebalanceos.

## Requisitos

- Python 3.12+
- Node.js 18+
- PostgreSQL (remoto, configurado en `.env`)
- Playwright (para el scraper de Facilito)

## Setup

### Backend

```bash
cd backend
pip install -r requirements.txt
playwright install chromium
```

Crear `backend/.env`:

```
DB_HOST=<host>
DB_PORT=5432
DB_NAME=db_control_operacional
DB_USER=<user>
DB_PASSWORD=<password>
```

### Frontend

```bash
cd frontend
npm install
```

## Correr

```bash
# Terminal 1 - Backend (puerto 8000)
cd backend
uvicorn main:app --reload

# Terminal 2 - Frontend (puerto 5173)
cd frontend
npm run dev
```

Abrir http://localhost:5173

## Estructura

```
backend/
  main.py              # API FastAPI (endpoints de carga, cruce, rebalanceo, mapa)
  facilito_scraper.py  # Scraper de precios de combustible (OSINERGMIN)
  facilito_cache/      # Cache diario del scraper
  .env                 # Variables de conexion a BD

frontend/
  src/App.jsx          # App React (AG Grid + Leaflet)
  package.json         # Vite + React 18
```

## API Endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/api/db/filters` | Fechas y empresas disponibles en BD |
| POST | `/api/db/load` | Cargar datos desde BD (async) |
| GET | `/api/db/progress` | Progreso de carga de BD |
| GET | `/api/db/status` | Estado de datos cargados en sesion |
| POST | `/api/upload/viajes` | Subir Excel de viajes |
| POST | `/api/upload/asistencia` | Subir Excel de asistencia |
| POST | `/api/process` | Cruzar viajes + asistencia + jarras + actividad |
| POST | `/api/rebalanceo` | Generar recomendaciones de rebalanceo |
| GET | `/api/rutas-mapa` | Datos de rutas para el mapa Leaflet |
| GET | `/api/facilito/*` | Scraper de precios de combustible |

## Flujo de uso

1. **Cargar datos**: desde BD (filtrar por fecha/empresa) o subir Excels manualmente
2. **Procesar**: cruza viajes con asistencia, enriquece con jarras y actividad
3. **Analizar**: tabla con ocupacion por bus, metricas, mapa de rutas
4. **Rebalancear**: define umbral de ocupacion, genera propuesta de redistribucion de pasajeros

## Tech Stack

- **Backend**: FastAPI, Pandas, psycopg2, Playwright
- **Frontend**: React 18, Vite, AG Grid, React-Leaflet
