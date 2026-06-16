# PageRank Project

Monorepo educativo para rastrear paginas de un mismo dominio, construir un grafo dirigido de enlaces y calcular PageRank desde una interfaz web.

- `backend/`: API FastAPI con crawler HTML, jobs en memoria, canonicalizacion de URLs, endpoints de inicio/estado/stop/resultado y bloqueo de hosts privados/locales.
- `frontend/`: app Next.js con formulario de crawl, polling de estado, carga del grafo, calculo PageRank en cliente, visualizacion con Cytoscape y export CSV/JSON.

## Requisitos locales

- Python 3.10+ recomendado. Verificado con Python 3.12.2.
- Node.js >= 20.9.0, requerido por Next.js 16. Verificado con Node 20.19.5.
- npm. Verificado con npm 10.8.2.
- Acceso a internet para que el crawler pueda consultar URLs publicas.

El backend bloquea `localhost`, IPs privadas y hosts `.local` por seguridad, asi que el crawler esta pensado para probar sitios publicos.
La URL inicial por defecto de la UI es `https://www.upb.edu`.

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

## Instalacion

Desde la raiz del proyecto:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

En otra terminal, instala el frontend:

```bash
cd frontend
npm ci
```

Si no quieres usar instalacion reproducible con `package-lock.json`, puedes usar `npm install`.

## Levantar localmente

Necesitas dos terminales: una para la API y otra para la interfaz.

Terminal 1, backend:

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

La API queda disponible en `http://127.0.0.1:8000`.

Terminal 2, frontend:

```bash
cd frontend
npm run dev
```

La app queda disponible en `http://localhost:3000`.

Por defecto el frontend llama a `http://localhost:8000`. Si levantas el backend en otro host o puerto, crea `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_BASE=http://localhost:8000
```

Luego reinicia `npm run dev`, porque las variables `NEXT_PUBLIC_*` se leen al arrancar Next.js.

## Smoke test

Con ambos servicios levantados, verifica la API:

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

La respuesta devuelve un `jobId`. Con ese valor puedes consultar:

```bash
curl "http://127.0.0.1:8000/api/crawl/status?jobId=JOB_ID"
curl "http://127.0.0.1:8000/api/crawl/result?jobId=JOB_ID"
```

## Flujo de uso en la UI

1. Abre `http://localhost:3000`.
2. Ingresa una URL publica. Si omites `http://` o `https://`, la UI asume `https://`.
3. Ajusta `maxPages` y `maxDepth`.
4. Presiona `Crawl`.
5. Espera a que el estado sea `done`, o presiona `Stop` cuando quieras analizar un grafo parcial.
6. Presiona `Load Graph`. Este boton se habilita con estado `done` o con estado `stopped` si el crawler alcanzo a visitar al menos una pagina.
7. Presiona `Run PageRank`.
8. Revisa ranking, detalle de enlaces, visualizacion y exportaciones.

La UI bloquea `Load Graph` mientras el crawl sigue en ejecucion para evitar leer un resultado que todavia esta cambiando. Tambien guarda un snapshot en `localStorage` para recuperar la ultima configuracion, grafo y ranking.

## Funcionamiento actual

- El crawler solo sigue enlaces del mismo dominio exacto que la URL inicial.
- Ignora `mailto:`, `tel:`, `javascript:` y fragments (`#...`).
- Ignora query params de forma predeterminada (`ignoreQueryParams=true`) para evitar que URLs de tracking como `?utm_source=...` generen nodos duplicados artificiales.
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
- El crawler no sigue sitios locales o privados por el bloqueo de seguridad.
- El backend permite CORS desde `http://localhost:3000` y `http://127.0.0.1:3000`. Si Next.js corre en otro puerto, ajusta el CORS en `backend/app/main.py`.
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
.venv/bin/python -m unittest discover -s tests
```

Frontend:

```bash
cd frontend
npm run test
npm run lint
npm run build
```

`npm run build` ejecuta `next build --webpack`.

Checks verificados en este entorno:

- Backend tests: 4 pruebas OK.
- Frontend tests: 8 pruebas OK.
- Frontend lint/typecheck: OK.
- Frontend build: OK.
- Smoke test local: `/health`, `/api/crawl/start`, `/api/crawl/status` y `/api/crawl/result` respondieron OK.
