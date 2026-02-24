// ============================================================
// Sistema de Alertamiento Carretero — Frontend App
// Leaflet Map + Socket.io Real-Time Updates
// ============================================================

(function () {
    'use strict';

    // ── Config ────────────────────────────────────────────
    const MAP_CENTER = [20.95, -97.40]; // Tuxpan, Veracruz
    const MAP_ZOOM = 13;

    // ── Tipos de alerta → estilos ─────────────────────────
    const ALERT_STYLES = {
        accidente: { icon: '💥', color: '#ef4444', label: 'Accidente' },
        derrumbe: { icon: '🪨', color: '#f97316', label: 'Derrumbe' },
        inundacion: { icon: '🌊', color: '#3b82f6', label: 'Inundación' },
        obra_vial: { icon: '🚧', color: '#eab308', label: 'Obra Vial' },
        animal_en_via: { icon: '🐄', color: '#22c55e', label: 'Animal en Vía' },
        bache: { icon: '🕳️', color: '#a855f7', label: 'Bache' },
        default: { icon: '⚠️', color: '#a855f7', label: 'Alerta' },
    };

    // ── State ─────────────────────────────────────────────
    let map;
    let alertLayer;
    let socket;
    let alertCount = { total: 0, app: 0, twitter: 0 };

    // ── Inicializar Mapa ──────────────────────────────────
    function initMap() {
        map = L.map('map', {
            center: MAP_CENTER,
            zoom: MAP_ZOOM,
            zoomControl: false,
            attributionControl: true,
        });

        // Zoom control en posición personalizada
        L.control.zoom({ position: 'bottomright' }).addTo(map);

        // Tile layer oscuro (CartoDB Dark Matter)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 19,
        }).addTo(map);

        // Capa para los marcadores de alertas
        alertLayer = L.layerGroup().addTo(map);
    }

    // ── Crear marcador personalizado ───────────────────────
    function createAlertMarker(feature, animated) {
        const props = feature.properties;
        const coords = feature.geometry.coordinates; // [lng, lat]
        const style = ALERT_STYLES[props.tipo_alerta] || ALERT_STYLES.default;

        // Crear icono HTML personalizado
        const iconHtml = `
      <div class="marker-pin ${animated ? 'marker-new' : ''}" style="background: ${style.color};">
        <span class="marker-pin-inner">${style.icon}</span>
        ${animated ? `<span class="marker-pulse-ring" style="border-color: ${style.color};"></span>` : ''}
      </div>
    `;

        const icon = L.divIcon({
            className: 'custom-marker',
            html: iconHtml,
            iconSize: [36, 36],
            iconAnchor: [18, 36],
            popupAnchor: [0, -36],
        });

        const marker = L.marker([coords[1], coords[0]], { icon });

        // Popup con detalles
        const popupHtml = buildPopupHtml(props, style);
        marker.bindPopup(popupHtml, { maxWidth: 280, minWidth: 220 });

        return marker;
    }

    // ── Construir HTML del popup ──────────────────────────
    function buildPopupHtml(props, style) {
        const fecha = new Date(props.fecha_creacion);
        const fechaStr = fecha.toLocaleString('es-MX', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });

        let html = `
      <div class="popup-header">
        <span class="popup-icon">${style.icon}</span>
        <span class="popup-title">${style.label}</span>
        <span class="popup-badge ${props.origen}">${props.origen}</span>
      </div>
      <div class="popup-row">
        <span class="popup-row-label">Fecha</span>
        <span>${fechaStr}</span>
      </div>
      <div class="popup-row">
        <span class="popup-row-label">Estado</span>
        <span style="color: ${props.activa ? '#22c55e' : '#ef4444'};">
          ${props.activa ? '● Activa' : '○ Inactiva'}
        </span>
      </div>
    `;

        if (props.distancia_metros !== undefined) {
            html += `
        <div class="popup-row">
          <span class="popup-row-label">Distancia</span>
          <span>${props.distancia_metros} m</span>
        </div>
      `;
        }

        if (props.descripcion) {
            html += `<div class="popup-description">${escapeHtml(props.descripcion)}</div>`;
        }

        if (props.foto_url) {
            html += `<img class="popup-photo" src="${props.foto_url}" alt="Foto de la alerta" loading="lazy">`;
        }

        return html;
    }

    // ── Cargar alertas iniciales ──────────────────────────
    async function loadAlerts() {
        try {
            const res = await fetch('/api/mapa');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const geojson = await res.json();

            // Limpiar capa
            alertLayer.clearLayers();
            alertCount = { total: 0, app: 0, twitter: 0 };

            geojson.features.forEach((feature) => {
                const marker = createAlertMarker(feature, false);
                alertLayer.addLayer(marker);
                countAlert(feature.properties.origen);
            });

            updateStats();
            console.log(`📍 ${geojson.features.length} alertas cargadas en el mapa`);
        } catch (err) {
            console.error('Error cargando alertas:', err);
            showToast('❌', 'Error al cargar alertas del servidor');
        }
    }

    // ── Conectar Socket.io ────────────────────────────────
    function initSocket() {
        socket = io();

        socket.on('connect', () => {
            console.log('🟢 Conectado al servidor Socket.io');
            updateConnectionStatus(true);
        });

        socket.on('disconnect', () => {
            console.log('🔴 Desconectado del servidor Socket.io');
            updateConnectionStatus(false);
        });

        // Escuchar nuevas alertas en tiempo real
        socket.on('nueva_alerta', (feature) => {
            console.log('🚨 Nueva alerta recibida:', feature);

            // Agregar marcador con animación
            const marker = createAlertMarker(feature, true);
            alertLayer.addLayer(marker);

            // Actualizar estadísticas
            countAlert(feature.properties.origen);
            updateStats();

            // Agregar a actividad reciente
            const style = ALERT_STYLES[feature.properties.tipo_alerta] || ALERT_STYLES.default;
            addActivity(style.icon, `${style.label} reportada vía ${feature.properties.origen}`);

            // Mostrar toast
            showToast(style.icon, `Nueva alerta: ${style.label}`);

            // Centrar el mapa suavemente en la nueva alerta
            const coords = feature.geometry.coordinates;
            map.flyTo([coords[1], coords[0]], Math.max(map.getZoom(), 14), {
                duration: 1.5,
            });
        });
    }

    // ── Contadores ────────────────────────────────────────
    function countAlert(origen) {
        alertCount.total++;
        if (origen === 'app') alertCount.app++;
        else if (origen === 'twitter') alertCount.twitter++;
    }

    function updateStats() {
        animateValue('totalAlertas', alertCount.total);
        animateValue('totalApp', alertCount.app);
        animateValue('totalTwitter', alertCount.twitter);
    }

    function animateValue(elementId, value) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const current = parseInt(el.textContent) || 0;
        if (current === value) return;

        const duration = 400;
        const start = performance.now();

        function tick(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
            el.textContent = Math.round(current + (value - current) * eased);
            if (progress < 1) requestAnimationFrame(tick);
        }

        requestAnimationFrame(tick);
    }

    // ── Estado de conexión ────────────────────────────────
    function updateConnectionStatus(connected) {
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');
        if (connected) {
            dot.className = 'status-dot connected';
            text.textContent = 'En Vivo';
        } else {
            dot.className = 'status-dot disconnected';
            text.textContent = 'Desconectado';
        }
    }

    // ── Toast Notifications ───────────────────────────────
    function showToast(icon, message) {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${escapeHtml(message)}</span>`;
        container.appendChild(toast);

        // Auto-remove after animation
        setTimeout(() => toast.remove(), 4500);
    }

    // ── Activity Feed ─────────────────────────────────────
    function addActivity(icon, text) {
        const list = document.getElementById('activityList');
        const empty = list.querySelector('.activity-empty');
        if (empty) empty.remove();

        const now = new Date();
        const timeStr = now.toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });

        const item = document.createElement('div');
        item.className = 'activity-item';
        item.innerHTML = `
      <span class="activity-item-icon">${icon}</span>
      <div>
        <div class="activity-item-text">${escapeHtml(text)}</div>
        <div class="activity-item-time">${timeStr}</div>
      </div>
    `;

        list.prepend(item);

        // Mantener máximo 20 items
        while (list.children.length > 20) {
            list.lastElementChild.remove();
        }
    }

    // ── Test Button ───────────────────────────────────────
    function initTestButton() {
        const btn = document.getElementById('btnTest');
        if (!btn) return;

        const testTypes = ['accidente', 'derrumbe', 'inundacion', 'obra_vial', 'animal_en_via', 'bache'];

        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = '⏳ Enviando...';

            // Generar ubicación aleatoria cerca de Tuxpan
            const lat = 20.95 + (Math.random() - 0.5) * 0.06;
            const lng = -97.40 + (Math.random() - 0.5) * 0.06;
            const tipo = testTypes[Math.floor(Math.random() * testTypes.length)];

            try {
                const formData = new FormData();
                formData.append('lat', lat.toFixed(6));
                formData.append('lng', lng.toFixed(6));
                formData.append('tipo_alerta', tipo);
                formData.append('origen', 'app');
                formData.append('descripcion', `Alerta de prueba: ${tipo} generada desde el Centro de Mando`);

                const res = await fetch('/api/alertas', { method: 'POST', body: formData });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                console.log('✅ Alerta de prueba enviada');
            } catch (err) {
                console.error('Error enviando alerta de prueba:', err);
                showToast('❌', 'Error al enviar alerta de prueba');
            }

            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = '🧪 Enviar Alerta de Prueba';
            }, 1500);
        });
    }

    // ── Utilities ─────────────────────────────────────────
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Init ──────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        initMap();
        loadAlerts();
        initSocket();
        initTestButton();
        addActivity('🚀', 'Centro de Mando inicializado');
    });
})();
