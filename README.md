# PageRank Project

Aplicacion educativa para rastrear paginas de un mismo dominio, construir un grafo dirigido de enlaces y calcular PageRank desde una interfaz web.

- `backend/`: API FastAPI con crawler HTML, jobs en memoria, canonicalizacion de URLs, endpoints de inicio/estado/stop/resultado y bloqueo de hosts privados/locales.
- `frontend/`: app Next.js con formulario de crawl, polling de estado, carga del grafo, calculo PageRank en cliente, visualizacion con Cytoscape y exportacion CSV/JSON.

## Requisitos

Antes de clonar el proyecto instala:

- Git.
- Python 3.10 o superior. Este proyecto fue verificado con Python 3.12.2.
- Node.js 20.9.0 o superior, requerido por Next.js 16. Este proyecto fue verificado con Node 20.19.5.
- npm. Este proyecto fue verificado con npm 10.8.2.
- Acceso a internet para que el crawler pueda consultar sitios publicos.

Verifica tus versiones:

```bash
git --version
python3 --version
node --version
npm --version
```

En Windows, si `python3` no existe, prueba con `python`.

## Clonar el repositorio

```bash
git clone https://github.com/Bfdiego/PageRank_Project_UPB.git
cd PageRank_Project_UPB
```

Si ya tienes el repositorio clonado:

```bash
cd PageRank_Project_UPB
git pull
```

## Estructura

```text
PageRank_Project/
├─ README.md
├─ backend/
│  ├─ requirements.txt
│  ├─ app/
│  │  └─ main.py
│  └─ tests/
│     └─ test_main.py
└─ frontend/
   ├─ package.json
   ├─ package-lock.json
   ├─ next.config.mjs
   ├─ tsconfig.json
   ├─ tsconfig.test.json
   └─ src/
      ├─ app/
      ├─ components/
      └─ lib/
```

## Instalacion desde cero

Haz estos pasos una sola vez despues de clonar.

### 1. Backend

En macOS o Linux:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cd ..
```

En Windows PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
cd ..
```

### 2. Frontend

Desde la raiz del proyecto:

```bash
cd frontend
npm ci
cd ..
```

`npm ci` usa `package-lock.json` y deja una instalacion reproducible. Si necesitas regenerar dependencias, usa `npm install`.

## Levantar la aplicacion

Necesitas dos terminales abiertas al mismo tiempo: una para la API y otra para la interfaz.

### Terminal 1: backend

En macOS o Linux:

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

En Windows PowerShell:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

La API queda disponible en:

```text
http://127.0.0.1:8000
```

### Terminal 2: frontend

```bash
cd frontend
npm run dev
```

La app queda disponible normalmente en:

```text
http://localhost:3000
```

Si el puerto `3000` esta ocupado, Next.js puede usar `3001` u otro puerto. Usa la URL que aparezca en la terminal.

## Configuracion opcional

Por defecto el frontend llama al backend en `http://localhost:8000`.

Si levantas el backend en otro host o puerto, crea `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_BASE=http://localhost:8000
```

Cambia el valor segun tu caso y reinicia `npm run dev`, porque las variables `NEXT_PUBLIC_*` se leen cuando arranca Next.js.

No necesitas crear `.env` para el flujo local normal.

## Verificacion rapida

Con backend y frontend levantados, verifica la API:

```bash
curl http://127.0.0.1:8000/health
```

Respuesta esperada:

```json
{"ok":true}
```

Inicia un crawl pequeno:

```bash
curl -X POST http://127.0.0.1:8000/api/crawl/start \
  -H "Content-Type: application/json" \
  -d '{"startUrl":"https://www.upb.edu","maxPages":5,"maxDepth":1,"ignoreQueryParams":true}'
```

La respuesta devuelve un `jobId`:

```json
{"jobId":"abc123..."}
```

Consulta el estado reemplazando `JOB_ID` por ese valor:

```bash
curl "http://127.0.0.1:8000/api/crawl/status?jobId=JOB_ID"
```

Cuando `state` sea `done` o `stopped`, consulta el resultado:

```bash
curl "http://127.0.0.1:8000/api/crawl/result?jobId=JOB_ID"
```

## Flujo de uso en la UI

1. Abre `http://localhost:3000` o el puerto que indique Next.js.
2. Ingresa una URL publica. Si omites `http://` o `https://`, la UI asume `https://`.
3. Ajusta `maxPages` y `maxDepth`.
4. Presiona `Crawl`.
5. Espera a que el estado sea `done`, o presiona `Stop` si quieres analizar un grafo parcial.
6. Presiona `Load Graph`. Este boton se habilita con estado `done` o con estado `stopped` si el crawler alcanzo a visitar al menos una pagina.
7. Presiona `Run PageRank`.
8. Revisa ranking, detalle de enlaces, visualizacion y exportaciones.

La UI bloquea `Load Graph` mientras el crawl sigue en ejecucion para evitar leer un resultado que todavia esta cambiando. Tambien guarda un snapshot en `localStorage` para recuperar la ultima configuracion, grafo y ranking.

## Funcionamiento actual

- El crawler solo sigue enlaces del mismo dominio exacto que la URL inicial.
- Ignora `mailto:`, `tel:`, `javascript:` y fragments (`#...`).
- Ignora query params de forma predeterminada (`ignoreQueryParams=true`) para evitar que URLs de tracking como `?utm_source=...` generen nodos duplicados.
- Resuelve rutas relativas contra la pagina actual.
- Si el crawl inicia en `https`, fuerza enlaces internos `http` del mismo host a `https`.
- Limita el recorrido por `maxPages` y `maxDepth`.
- Deduplica enlaces y excluye self-loops al devolver el grafo.
- Calcula PageRank en el frontend con amortiguacion, iteraciones y tolerancia configurables.
- Exporta ranking en CSV y grafo en JSON desde el navegador.

## Limitaciones importantes

- `renderJs=true` existe en el contrato de API, pero todavia no esta soportado; el backend responde error si se envia en `true`.
- Los jobs viven en memoria. Si reinicias el backend, se pierden los `jobId` y resultados anteriores.
- Si presionas `Stop`, el backend puede tardar hasta terminar la peticion HTTP actual antes de cambiar a `stopped`.
- El crawler bloquea `localhost`, IPs privadas y hosts `.local` por seguridad. Esta pensado para sitios publicos.
- En desarrollo, el backend permite CORS desde `localhost`, `127.0.0.1` y `[::1]` en cualquier puerto. Esto cubre el cambio automatico de Next.js a `3001` cuando `3000` esta ocupado.
- El modo dev usa Turbopack (`npm run dev`). El build de produccion usa Webpack mediante `next build --webpack`.

## Endpoints principales

- `GET /health`
- `POST /api/crawl/start`
- `POST /api/crawl/stop`
- `GET /api/crawl/status?jobId=...`
- `GET /api/crawl/result?jobId=...`

## Pruebas y checks

Backend:

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -q
```

Frontend:

```bash
cd frontend
npm run test
npm run lint
npm run build
```

`npm run lint` ejecuta TypeScript con `tsc --noEmit`. `npm run build` ejecuta `next build --webpack`.

## Problemas frecuentes

### `uvicorn: command not found`

Activa el entorno virtual del backend y vuelve a instalar dependencias:

```bash
cd backend
source .venv/bin/activate
pip install -r requirements.txt
```

En Windows usa `.\.venv\Scripts\Activate.ps1`.

### `ModuleNotFoundError: No module named 'httpx'` o `No module named 'fastapi'`

Estas usando otro Python. Ejecuta el backend desde el entorno virtual:

```bash
cd backend
source .venv/bin/activate
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### El frontend dice que no puede conectar con la API

Verifica que el backend este corriendo:

```bash
curl http://127.0.0.1:8000/health
```

Si cambiaste el puerto del backend, configura `frontend/.env.local` con `NEXT_PUBLIC_API_BASE` y reinicia `npm run dev`.

### El puerto `3000` o `8000` esta ocupado

Para el frontend, usa la URL alternativa que Next.js muestre en la terminal.

Para el backend, puedes cambiar el puerto:

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Luego configura `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_BASE=http://localhost:8001
```

### El crawler rechaza una URL local

Es esperado. Por seguridad, el backend no rastrea `localhost`, IPs privadas ni hosts `.local`. Usa una URL publica como `https://www.upb.edu`.

## Validacion de esta version

Checks ejecutados localmente:

- Backend tests: 6 pruebas OK.
- Frontend tests: 12 pruebas OK.
- Frontend lint/typecheck: OK.
- Frontend build: OK.
