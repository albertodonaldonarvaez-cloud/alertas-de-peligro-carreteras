-- ============================================================
-- Sistema de Alertamiento Carretero - Inicialización de BD
-- ============================================================

-- Habilitar extensión PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Habilitar extensión para generación de UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Crear tipo ENUM para el origen de la alerta
CREATE TYPE origen_alerta AS ENUM ('app', 'twitter');

-- Crear tabla principal de alertas
CREATE TABLE IF NOT EXISTS alertas (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tipo_alerta     VARCHAR(100) NOT NULL,
    origen          origen_alerta NOT NULL DEFAULT 'app',
    ubicacion       GEOMETRY(Point, 4326) NOT NULL,
    foto_url        VARCHAR(500),
    descripcion     TEXT,
    activa          BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice espacial GIST para consultas geoespaciales eficientes
CREATE INDEX IF NOT EXISTS idx_alertas_ubicacion
    ON alertas USING GIST (ubicacion);

-- Índice para filtrar alertas activas rápidamente
CREATE INDEX IF NOT EXISTS idx_alertas_activa
    ON alertas (activa)
    WHERE activa = TRUE;

-- Índice en fecha para ordenamiento temporal
CREATE INDEX IF NOT EXISTS idx_alertas_fecha
    ON alertas (fecha_creacion DESC);

-- ============================================================
-- Datos de ejemplo para pruebas (carreteras de Tuxpan, Veracruz)
-- ============================================================
INSERT INTO alertas (tipo_alerta, origen, ubicacion, descripcion) VALUES
    ('peligro',         'app',     ST_SetSRID(ST_MakePoint(-97.4050, 20.9500), 4326), '⚠️ PELIGRO: Tramo de alta peligrosidad, precaución extrema'),
    ('accidente',       'app',     ST_SetSRID(ST_MakePoint(-97.3983, 20.9574), 4326), 'Accidente vehicular en libramiento Tuxpan'),
    ('derrumbe',        'twitter', ST_SetSRID(ST_MakePoint(-97.4150, 20.9350), 4326), 'Derrumbe parcial reportado en carretera costera'),
    ('inundacion',      'app',     ST_SetSRID(ST_MakePoint(-97.3800, 20.9700), 4326), 'Tramo inundado después de lluvias fuertes'),
    ('obra_vial',       'app',     ST_SetSRID(ST_MakePoint(-97.4300, 20.9450), 4326), 'Obra en progreso, carril cerrado km 15'),
    ('animal_en_via',   'twitter', ST_SetSRID(ST_MakePoint(-97.3650, 20.9650), 4326), 'Ganado suelto sobre la carretera federal');
