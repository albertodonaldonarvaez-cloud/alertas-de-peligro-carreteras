// ============================================================
// Sistema de Alertamiento Carretero en Tiempo Real
// Backend: Express + Socket.io + PostGIS
// ============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// ── Configuración ────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'alertas_carreteras',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres_secret_2024',
});

// ── Express + Socket.io ──────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ── Middlewares ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Multer (subida de imágenes) ─────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB máximo
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype);
    cb(null, extOk && mimeOk);
  },
});

// ── Helpers ─────────────────────────────────────────────────
function buildGeoJSONFeature(row) {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [parseFloat(row.lng), parseFloat(row.lat)],
    },
    properties: {
      id: row.id,
      tipo_alerta: row.tipo_alerta,
      origen: row.origen,
      foto_url: row.foto_url || null,
      descripcion: row.descripcion || null,
      activa: row.activa,
      fecha_creacion: row.fecha_creacion,
    },
  };
}

// ============================================================
// ENDPOINTS
// ============================================================

// ── POST /api/alertas ─────────────────────────────────────
// Recibe un reporte de alerta con ubicación GPS y foto opcional.
// Inserta en PostGIS y emite evento Socket.io en tiempo real.
app.post('/api/alertas', upload.single('foto'), async (req, res) => {
  try {
    const { lat, lng, tipo_alerta, origen } = req.body;

    // Validación
    if (!lat || !lng || !tipo_alerta) {
      return res.status(400).json({
        error: 'Campos requeridos: lat, lng, tipo_alerta',
      });
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      return res.status(400).json({ error: 'lat y lng deben ser números válidos' });
    }

    const origenValido = origen === 'twitter' ? 'twitter' : 'app';
    const fotoUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const descripcion = req.body.descripcion || null;

    const query = `
      INSERT INTO alertas (tipo_alerta, origen, ubicacion, foto_url, descripcion)
      VALUES ($1, $2::origen_alerta, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6)
      RETURNING id, tipo_alerta, origen, foto_url, descripcion, activa, fecha_creacion,
                ST_Y(ubicacion) AS lat, ST_X(ubicacion) AS lng
    `;

    const result = await pool.query(query, [
      tipo_alerta, origenValido, lngNum, latNum, fotoUrl, descripcion,
    ]);

    const alerta = result.rows[0];
    const feature = buildGeoJSONFeature(alerta);

    // Emitir en tiempo real a todos los clientes conectados
    io.emit('nueva_alerta', feature);

    res.status(201).json({
      success: true,
      message: 'Alerta registrada exitosamente',
      data: feature,
    });
  } catch (err) {
    console.error('Error en POST /api/alertas:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/rastreo ──────────────────────────────────────
// Recibe la ubicación actual de un usuario y devuelve alertas
// activas a menos de 3 km usando ST_DWithin (consulta espacial).
app.post('/api/rastreo', async (req, res) => {
  try {
    const { lat, lng } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Campos requeridos: lat, lng' });
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      return res.status(400).json({ error: 'lat y lng deben ser números válidos' });
    }

    // ST_DWithin con geografía para cálculo en metros (3000m = 3km)
    const query = `
      SELECT id, tipo_alerta, origen, foto_url, descripcion, activa, fecha_creacion,
             ST_Y(ubicacion) AS lat, ST_X(ubicacion) AS lng,
             ST_Distance(
               ubicacion::geography,
               ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
             ) AS distancia_metros
      FROM alertas
      WHERE activa = TRUE
        AND ST_DWithin(
              ubicacion::geography,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
              3000
            )
      ORDER BY distancia_metros ASC
    `;

    const result = await pool.query(query, [lngNum, latNum]);

    const features = result.rows.map((row) => {
      const feature = buildGeoJSONFeature(row);
      feature.properties.distancia_metros = Math.round(parseFloat(row.distancia_metros));
      return feature;
    });

    res.json({
      type: 'FeatureCollection',
      total: features.length,
      radio_km: 3,
      features,
    });
  } catch (err) {
    console.error('Error en POST /api/rastreo:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/webhook/twitter ─────────────────────────────
// Endpoint ligero para que n8n inyecte alertas parseadas de X/Twitter.
app.post('/api/webhook/twitter', async (req, res) => {
  try {
    const { lat, lng, tipo_alerta, texto } = req.body;

    if (!lat || !lng || !tipo_alerta) {
      return res.status(400).json({
        error: 'Campos requeridos: lat, lng, tipo_alerta',
      });
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      return res.status(400).json({ error: 'lat y lng deben ser números válidos' });
    }

    const query = `
      INSERT INTO alertas (tipo_alerta, origen, ubicacion, descripcion)
      VALUES ($1, 'twitter'::origen_alerta, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4)
      RETURNING id, tipo_alerta, origen, foto_url, descripcion, activa, fecha_creacion,
                ST_Y(ubicacion) AS lat, ST_X(ubicacion) AS lng
    `;

    const result = await pool.query(query, [tipo_alerta, lngNum, latNum, texto || null]);

    const alerta = result.rows[0];
    const feature = buildGeoJSONFeature(alerta);

    // Emitir en tiempo real
    io.emit('nueva_alerta', feature);

    res.status(201).json({
      success: true,
      message: 'Alerta de Twitter registrada',
      data: feature,
    });
  } catch (err) {
    console.error('Error en POST /api/webhook/twitter:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/mapa ─────────────────────────────────────────
// Devuelve todas las alertas activas como GeoJSON FeatureCollection.
app.get('/api/mapa', async (req, res) => {
  try {
    const query = `
      SELECT id, tipo_alerta, origen, foto_url, descripcion, activa, fecha_creacion,
             ST_Y(ubicacion) AS lat, ST_X(ubicacion) AS lng
      FROM alertas
      WHERE activa = TRUE
      ORDER BY fecha_creacion DESC
    `;

    const result = await pool.query(query);

    const featureCollection = {
      type: 'FeatureCollection',
      features: result.rows.map(buildGeoJSONFeature),
    };

    res.json(featureCollection);
  } catch (err) {
    console.error('Error en GET /api/mapa:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Socket.io ────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🟢 Cliente conectado: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`🔴 Cliente desconectado: ${socket.id}`);
  });
});

// ── Iniciar servidor ────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║  🚨 Sistema de Alertamiento Carretero           ║
║  🌐 Servidor activo en http://0.0.0.0:${PORT}      ║
║  📡 Socket.io listo para conexiones             ║
║  🗄️  PostGIS: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}                    ║
╚══════════════════════════════════════════════════╝
  `);
});
