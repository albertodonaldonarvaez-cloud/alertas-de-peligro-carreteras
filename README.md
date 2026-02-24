# 🚨 Sistema de Alertamiento Carretero en Tiempo Real

Sistema backend + frontend web para recibir y visualizar reportes de peligros viales en tiempo real. Los reportes provienen de una app móvil (GPS + fotos) y de X/Twitter (vía n8n). El frontend muestra un mapa interactivo con alertas activas usando Leaflet.js.

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white" alt="Express">
  <img src="https://img.shields.io/badge/PostGIS-3.4-336791?logo=postgresql&logoColor=white" alt="PostGIS">
  <img src="https://img.shields.io/badge/Socket.io-4.x-010101?logo=socket.io&logoColor=white" alt="Socket.io">
  <img src="https://img.shields.io/badge/Leaflet-1.9-199900?logo=leaflet&logoColor=white" alt="Leaflet">
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" alt="Docker">
</p>

---

## 📐 Arquitectura

```
┌──────────────┐         ┌──────────────────────────────┐
│  App Móvil   │────────▶│                              │
│  (GPS+Foto)  │  POST   │     Node.js + Express        │
└──────────────┘ /alertas │     + Socket.io              │
                          │                              │
┌──────────────┐  POST    │   ┌──────────────────────┐   │       ┌──────────────────┐
│  n8n/Twitter │─────────▶│   │  API REST Endpoints  │───│──────▶│  PostgreSQL      │
└──────────────┘ /webhook │   └──────────────────────┘   │       │  + PostGIS       │
                          │                              │       │  (Spatial Index) │
                          │   ┌──────────────────────┐   │       └──────────────────┘
                          │   │  Socket.io Server     │   │
                          │   └─────────┬────────────┘   │
                          └─────────────│────────────────┘
                                        │ emit: nueva_alerta
                                        ▼
                          ┌──────────────────────────────┐
                          │  Frontend Web (Leaflet.js)   │
                          │  Centro de Mando - Dark Mode │
                          └──────────────────────────────┘
```

## ✨ Características

- 🗺️ **Mapa en tiempo real** con Leaflet.js centrado en Tuxpan, Veracruz
- 📡 **WebSockets** — las alertas aparecen instantáneamente sin recargar la página
- 🌎 **Consultas espaciales** con PostGIS (`ST_DWithin` para radio de 3 km)
- 📸 **Subida de fotos** con Multer (desde app móvil)
- 🐦 **Webhook para Twitter/n8n** — inyección de alertas geolocalizadas
- 🎨 **Interfaz dark-mode** con estética glassmorphism y marcadores animados
- 🐳 **Dockerizado** — listo para producción con `docker compose up`

## 🚀 Inicio Rápido

### Prerrequisitos

- [Docker](https://www.docker.com/) y Docker Compose instalados

### Despliegue

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/sistema-alertamiento-carretero.git
cd sistema-alertamiento-carretero

# Levantar los contenedores
docker compose up --build -d

# Ver logs
docker compose logs -f app
```

Abre **http://localhost:3000** en tu navegador.

> La base de datos se inicializa automáticamente con 5 alertas de ejemplo cerca de Tuxpan, Veracruz.

## 📡 API REST

### `POST /api/alertas`
Crea una alerta con ubicación GPS y foto opcional.

```bash
curl -X POST http://localhost:3000/api/alertas \
  -F "lat=20.95" \
  -F "lng=-97.40" \
  -F "tipo_alerta=accidente" \
  -F "origen=app" \
  -F "descripcion=Choque múltiple en km 12" \
  -F "foto=@./imagen.jpg"
```

### `POST /api/rastreo`
Busca alertas activas en un radio de **3 km** desde una coordenada.

```bash
curl -X POST http://localhost:3000/api/rastreo \
  -H "Content-Type: application/json" \
  -d '{"lat": 20.95, "lng": -97.40}'
```

### `POST /api/webhook/twitter`
Endpoint para n8n. Inyecta alertas parseadas desde X/Twitter.

```bash
curl -X POST http://localhost:3000/api/webhook/twitter \
  -H "Content-Type: application/json" \
  -d '{"lat": 20.96, "lng": -97.39, "tipo_alerta": "derrumbe", "texto": "Derrumbe en km 5"}'
```

### `GET /api/mapa`
Devuelve todas las alertas activas como GeoJSON `FeatureCollection`.

```bash
curl http://localhost:3000/api/mapa
```

## 🗃️ Estructura del Proyecto

```
sistema-alertamiento-carretero/
├── docker-compose.yml    # Orquestación: Node.js + PostGIS
├── Dockerfile            # Imagen Node 20 Alpine
├── init.sql              # Schema + índices + datos de ejemplo
├── package.json          # Dependencias npm
├── server.js             # Backend Express + Socket.io
├── public/
│   ├── index.html        # Centro de Mando (HTML)
│   ├── style.css         # Dark-mode glassmorphism
│   └── app.js            # Leaflet map + Socket.io client
└── uploads/              # Fotos subidas (volumen Docker)
```

## 🔧 Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `3000` | Puerto del servidor |
| `DB_HOST` | `localhost` | Host de PostgreSQL |
| `DB_PORT` | `5432` | Puerto de PostgreSQL |
| `DB_NAME` | `alertas_carreteras` | Nombre de la base de datos |
| `DB_USER` | `postgres` | Usuario de PostgreSQL |
| `DB_PASSWORD` | `postgres_secret_2024` | Contraseña de PostgreSQL |

## 🛣️ Tipos de Alerta Soportados

| Tipo | Icono | Color |
|------|-------|-------|
| `accidente` | 💥 | Rojo |
| `derrumbe` | 🪨 | Naranja |
| `inundacion` | 🌊 | Azul |
| `obra_vial` | 🚧 | Amarillo |
| `animal_en_via` | 🐄 | Verde |
| `bache` | 🕳️ | Morado |

## 📝 Licencia

MIT
