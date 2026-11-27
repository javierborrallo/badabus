// Leaflet map wrapper for badabus: Carto light/dark tiles, stops, line shapes, routes, and live GPS.

const CENTRO_BADAJOZ = [38.8794, -6.9707];
const ZOOM_INICIAL = 14;
const COLOR_HEX = /^#[0-9a-fA-F]{6}$/;
const COLOR_FALLBACK = "#0072C6";

const CAPAS_TILES = {
  claro: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  oscuro: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATRIBUCION_CARTO =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>';
const ATRIBUCION_OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export function colorSeguro(color) {
  return typeof color === "string" && COLOR_HEX.test(color) ? color : COLOR_FALLBACK;
}

export function distanciaKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const lat1 = a[0] * rad;
  const lat2 = b[0] * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function minutosAndando(km) {
  return (km * 1.3) / 4.5 * 60;
}

// Shortest forward leg from `subir` to `bajar` as [i, j], or null.
// On a tie, the smallest `i` wins.
function pasosEnTrazado(coord, pts, radioKm = 0.08) {
  const hits = [];
  let mejor = null;
  for (let k = 0; k < pts.length; k++) {
    const d = distanciaKm(coord, pts[k]);
    if (d < radioKm) {
      if (!mejor || d < mejor.d) mejor = { d, k };
    } else if (mejor) {
      hits.push(mejor);
      mejor = null;
    }
  }
  if (mejor) hits.push(mejor);
  if (!hits.length) {
    let bestK = 0;
    let bestD = Infinity;
    for (let k = 0; k < pts.length; k++) {
      const d = distanciaKm(coord, pts[k]);
      if (d < bestD) {
        bestD = d;
        bestK = k;
      }
    }
    hits.push({ d: bestD, k: bestK });
  }
  return hits;
}

export function trazarSegmento(linea, subir, bajar, shapes, red, paradaPorId) {
  const seq = red[linea] || [];
  const indices = indicesDeTramo(seq, subir, bajar);
  const paradasTramo = (
    indices ? seq.slice(indices[0], indices[1] + 1) : [subir, bajar]
  )
    .map((id) => paradaPorId[id])
    .filter(Boolean);
  const coordsParadas = paradasTramo.map((p) => [p.lat, p.lon]);
  const geom = shapes[linea];
  if (!geom || paradasTramo.length < 2) return coordsParadas;

  const sentidos = Object.values(geom)
    .filter((pts) => Array.isArray(pts) && pts.length >= 2)
    .map((pts) => {
      const acum = new Array(pts.length);
      acum[0] = 0;
      for (let k = 0; k < pts.length - 1; k++) {
        acum[k + 1] = acum[k] + distanciaKm(pts[k], pts[k + 1]);
      }
      const pasos = new Map();
      for (const p of paradasTramo) {
        if (!pasos.has(p.id)) pasos.set(p.id, pasosEnTrazado([p.lat, p.lon], pts));
      }
      return { pts, acum, pasos };
    });

  if (!sentidos.length) return coordsParadas;

  const salida = [];
  const anadir = (pt) => {
    const prev = salida[salida.length - 1];
    if (!prev || prev[0] !== pt[0] || prev[1] !== pt[1]) salida.push(pt);
  };

  for (let i = 0; i < paradasTramo.length - 1; i++) {
    const pa = paradasTramo[i];
    const pb = paradasTramo[i + 1];
    const cA = [pa.lat, pa.lon];
    const cB = [pb.lat, pb.lon];
    const recta = distanciaKm(cA, cB);
    let mejorSlice = null;
    let mejorKm = Infinity;
    if (recta > 0) {
      for (const { pts, acum, pasos } of sentidos) {
        const pasosA = pasos.get(pa.id) || [];
        const pasosB = pasos.get(pb.id) || [];
        for (const a of pasosA) {
          for (const b of pasosB) {
            if (b.k <= a.k || a.d + b.d >= 0.25) continue;
            const km = acum[b.k] - acum[a.k];
            if (km >= recta * 0.85 && km <= recta * 3 && km < mejorKm) {
              mejorKm = km;
              mejorSlice = pts.slice(a.k, b.k + 1);
            }
          }
        }
      }
    }
    for (const pt of mejorSlice || [cA, cB]) anadir(pt);
  }
  return salida.length >= 2 ? salida : coordsParadas;
}

export function indicesDeTramo(seq, subir, bajar) {
  const origen = String(subir);
  const fin = String(bajar);
  if (origen === fin) return null;
  let ultimoSubir = -1;
  let mejor = null;
  for (let j = 0; j < seq.length; j++) {
    const parada = String(seq[j]);
    if (parada === origen) {
      ultimoSubir = j;
    } else if (parada === fin && ultimoSubir >= 0 && (!mejor || j - ultimoSubir < mejor[1] - mejor[0])) {
      mejor = [ultimoSubir, j];
    }
  }
  return mejor;
}

export function crearMapa(contenedorId, callbacks = {}) {
  const L = window.L;
  const map = L.map(contenedorId, {
    center: CENTRO_BADAJOZ,
    zoom: ZOOM_INICIAL,
    zoomControl: false,
    attributionControl: true,
  });

  L.control.zoom({ position: "bottomright" }).addTo(map);

  let claveMapa = "";
  let temaActual = document.documentElement.dataset.theme === "oscuro" ? "oscuro" : "claro";
  let capaTiles = null;
  const capaTrazado = L.layerGroup().addTo(map);
  const capaRuta = L.layerGroup().addTo(map);
  const capaParadas = L.layerGroup().addTo(map);
  const capaSeleccion = L.layerGroup().addTo(map);
  const capaUsuario = L.layerGroup().addTo(map);

  const marcadores = new Map();
  let paradaPorIdLocal = {};
  let paradaActivaId = null;

  function aplicarTiles(tema) {
    temaActual = tema === "oscuro" ? "oscuro" : "claro";
    if (capaTiles) map.removeLayer(capaTiles);
    const cont = document.getElementById(contenedorId);
    if (claveMapa) {
      if (cont) cont.classList.remove("is-osm-fallback");
      const base = CAPAS_TILES[temaActual] || CAPAS_TILES.claro;
      capaTiles = L.tileLayer(`${base}?key=${encodeURIComponent(claveMapa)}`, {
        attribution: ATRIBUCION_CARTO,
        maxZoom: 19,
        subdomains: "abcd",
      }).addTo(map);
    } else {
      if (cont) cont.classList.add("is-osm-fallback");
      capaTiles = L.tileLayer(OSM_TILES, {
        attribution: ATRIBUCION_OSM,
        maxZoom: 19,
      }).addTo(map);
    }
  }

  aplicarTiles(temaActual);

  map.on("click", (ev) => {
    if (callbacks.onMapClick) callbacks.onMapClick(ev.latlng.lat, ev.latlng.lng);
  });

  function estiloParada(id, favorita, activa, filtrada) {
    const oscuro = temaActual === "oscuro";
    const primario = oscuro ? "#2E90FA" : "#0B4A82";
    const verde = oscuro ? "#22C98E" : "#0E8A55";
    if (activa) {
      return {
        radius: 7.5,
        color: "#FFFFFF",
        weight: 2.5,
        fillColor: primario,
        fillOpacity: 1,
      };
    }
    if (favorita) {
      return {
        radius: 5.5,
        color: oscuro ? "#0F1418" : "#FFFFFF",
        weight: 1.8,
        fillColor: verde,
        fillOpacity: 0.98,
      };
    }
    return {
      radius: filtrada ? 5.2 : 4.2,
      color: oscuro ? "#0F1418" : "#FFFFFF",
      weight: 1.5,
      fillColor: filtrada ? primario : verde,
      fillOpacity: filtrada ? 0.95 : 0.85,
    };
  }

  function pintarSeleccion(id) {
    capaSeleccion.clearLayers();
    const p = id ? paradaPorIdLocal[String(id)] : null;
    if (!p) return;
    const oscuro = temaActual === "oscuro";
    const primario = oscuro ? "#2E90FA" : "#0B4A82";
    L.circleMarker([p.lat, p.lon], {
      radius: 14,
      color: "transparent",
      fillColor: primario,
      fillOpacity: 0.22,
      interactive: false,
    }).addTo(capaSeleccion);
    L.circleMarker([p.lat, p.lon], {
      radius: 7,
      color: "#FFFFFF",
      weight: 2.5,
      fillColor: primario,
      fillOpacity: 1,
      interactive: false,
    })
      .bindTooltip(p.nombre, {
        permanent: true,
        direction: "top",
        offset: [0, -10],
        className: "map-active-label",
      })
      .addTo(capaSeleccion);
  }

  function pintarParadas(paradas, { favoritas = new Set(), activaId = null, filtroLinea = "" } = {}) {
    capaParadas.clearLayers();
    marcadores.clear();
    paradaPorIdLocal = {};
    paradaActivaId = activaId;
    for (const p of paradas) {
      paradaPorIdLocal[String(p.id)] = p;
      if (filtroLinea && !(p.lineas || []).includes(filtroLinea)) continue;
      const esFav = favoritas.has(String(p.id));
      const esAct = String(p.id) === String(activaId);
      const m = L.circleMarker([p.lat, p.lon], estiloParada(p.id, esFav, esAct, Boolean(filtroLinea)));
      m.on("click", (ev) => {
        L.DomEvent.stopPropagation(ev);
        if (callbacks.onStopClick) callbacks.onStopClick(p);
      });
      m.addTo(capaParadas);
      marcadores.set(String(p.id), m);
    }
    pintarSeleccion(activaId);
  }

  function resaltarParada(id, favoritas = new Set(), filtroLinea = "") {
    const prev = paradaActivaId ? marcadores.get(String(paradaActivaId)) : null;
    if (prev) {
      prev.setStyle(estiloParada(paradaActivaId, favoritas.has(String(paradaActivaId)), false, Boolean(filtroLinea)));
    }
    paradaActivaId = id;
    const next = id ? marcadores.get(String(id)) : null;
    if (next) {
      next.setStyle(estiloParada(id, favoritas.has(String(id)), true, Boolean(filtroLinea)));
    }
    pintarSeleccion(id);
  }

  function limpiarTrazado() {
    capaTrazado.clearLayers();
  }

  function limpiarRuta() {
    capaRuta.clearLayers();
  }

  function dibujarLinea(codigo, shapes, lineas, { ajustar = true } = {}) {
    capaTrazado.clearLayers();
    const geom = shapes[codigo];
    if (!geom) return;
    const color = colorSeguro(lineas[codigo]?.color);
    const bounds = L.latLngBounds([]);
    for (const puntos of Object.values(geom)) {
      if (!Array.isArray(puntos) || puntos.length < 2) continue;
      const poly = L.polyline(puntos, {
        color,
        weight: 4.5,
        opacity: 0.9,
        lineJoin: "round",
      }).addTo(capaTrazado);
      bounds.extend(poly.getBounds());
      if (L.polylineDecorator && L.Symbol?.arrowHead) {
        L.polylineDecorator(poly, {
          patterns: [
            {
              offset: "12%",
              repeat: "120px",
              symbol: L.Symbol.arrowHead({
                pixelSize: 9,
                polygon: false,
                pathOptions: { color, weight: 2.2, opacity: 0.9 },
              }),
            },
          ],
        }).addTo(capaTrazado);
      }
    }
    if (ajustar && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
    }
  }

  function segmentoShape(linea, subir, bajar, shapes, red, paradaPorId) {
    return trazarSegmento(linea, subir, bajar, shapes, red, paradaPorId);
  }

  function dibujarRuta(ruta, { origenCoord, destinoCoord, shapes, lineas, red, paradaPorId }) {
    capaRuta.clearLayers();
    if (!ruta || !ruta.tramos?.length) return;
    const bounds = L.latLngBounds([]);
    const oscuro = temaActual === "oscuro";
    const colorPie = oscuro ? "#8299AE" : "#4D606E";

    const primera = paradaPorId[ruta.tramos[0].subir];
    if (origenCoord && primera) {
      const l = L.polyline([origenCoord, [primera.lat, primera.lon]], {
        color: colorPie,
        weight: 3.5,
        dashArray: "6 7",
        opacity: 0.85,
      }).addTo(capaRuta);
      bounds.extend(l.getBounds());
    }

    ruta.tramos.forEach((tramo, idx) => {
      const color = colorSeguro(lineas[tramo.linea]?.color);
      const pts = segmentoShape(tramo.linea, tramo.subir, tramo.bajar, shapes, red, paradaPorId);
      if (pts.length >= 2) {
        const poly = L.polyline(pts, {
          color,
          weight: 5.5,
          opacity: 0.95,
          lineJoin: "round",
        }).addTo(capaRuta);
        bounds.extend(poly.getBounds());
      }
      const pSub = paradaPorId[tramo.subir];
      const pBaj = paradaPorId[tramo.bajar];
      for (const p of [pSub, pBaj]) {
        if (!p) continue;
        L.circleMarker([p.lat, p.lon], {
          radius: 6.5,
          color: "#FFFFFF",
          weight: 2.5,
          fillColor: color,
          fillOpacity: 1,
        })
          .bindTooltip(p.nombre)
          .addTo(capaRuta);
        bounds.extend([p.lat, p.lon]);
      }
      // Walking transfer between legs
      const sig = ruta.tramos[idx + 1];
      if (sig && pBaj && paradaPorId[sig.subir] && tramo.bajar !== sig.subir) {
        const pSig = paradaPorId[sig.subir];
        L.polyline(
          [
            [pBaj.lat, pBaj.lon],
            [pSig.lat, pSig.lon],
          ],
          { color: colorPie, weight: 3.5, dashArray: "5 6", opacity: 0.9 }
        ).addTo(capaRuta);
      }
    });

    const ultima = paradaPorId[ruta.tramos[ruta.tramos.length - 1].bajar];
    if (destinoCoord && ultima) {
      const l = L.polyline([[ultima.lat, ultima.lon], destinoCoord], {
        color: colorPie,
        weight: 3.5,
        dashArray: "6 7",
        opacity: 0.85,
      }).addTo(capaRuta);
      bounds.extend(l.getBounds());
    }

    if (origenCoord) {
      L.circleMarker(origenCoord, {
        radius: 7,
        color: "#FFFFFF",
        weight: 2.5,
        fillColor: "#0072C6",
        fillOpacity: 1,
      }).addTo(capaRuta);
    }
    if (destinoCoord) {
      L.circleMarker(destinoCoord, {
        radius: 7,
        color: "#FFFFFF",
        weight: 2.5,
        fillColor: "#0F9D68",
        fillOpacity: 1,
      }).addTo(capaRuta);
    }

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
    }
  }

  function dibujarViaje(viaje, { shapes, lineas, red, paradaPorId }) {
    capaRuta.clearLayers();
    if (!viaje || !viaje.paradas?.length) return;
    const color = colorSeguro(lineas[viaje.linea]?.color);
    const subir = viaje.paradas[0];
    const bajar = viaje.paradas[viaje.paradas.length - 1];
    const actual = viaje.paradas[Math.min(viaje.idxActual, viaje.paradas.length - 1)];

    // Dim full leg
    const fullPts = segmentoShape(viaje.linea, subir, bajar, shapes, red, paradaPorId);
    if (fullPts.length >= 2) {
      L.polyline(fullPts, { color, weight: 4.5, opacity: 0.32 }).addTo(capaRuta);
    }
    // Highlight remaining segment
    const remPts =
      actual !== bajar
        ? segmentoShape(viaje.linea, actual, bajar, shapes, red, paradaPorId)
        : [];
    const bounds = L.latLngBounds([]);
    if (remPts.length >= 2) {
      const poly = L.polyline(remPts, { color, weight: 6, opacity: 0.95 }).addTo(capaRuta);
      bounds.extend(poly.getBounds());
    }
    const pAct = paradaPorId[actual];
    const pBaj = paradaPorId[bajar];
    if (pAct) {
      L.circleMarker([pAct.lat, pAct.lon], {
        radius: 8,
        color: "#FFFFFF",
        weight: 3,
        fillColor: color,
        fillOpacity: 1,
      }).addTo(capaRuta);
      bounds.extend([pAct.lat, pAct.lon]);
    }
    if (pBaj) {
      L.circleMarker([pBaj.lat, pBaj.lon], {
        radius: 9,
        color: "#FFFFFF",
        weight: 3,
        fillColor: "#0F9D68",
        fillOpacity: 1,
      }).addTo(capaRuta);
      bounds.extend([pBaj.lat, pBaj.lon]);
    }
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [34, 34], maxZoom: 16 });
    }
  }

  function fijarUbicacion(lat, lon) {
    capaUsuario.clearLayers();
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const azul = temaActual === "oscuro" ? "#2DA3F8" : "#0072C6";
    L.circleMarker([lat, lon], {
      radius: 14,
      color: "transparent",
      fillColor: azul,
      fillOpacity: 0.18,
      interactive: false,
    }).addTo(capaUsuario);
    L.circleMarker([lat, lon], {
      radius: 6,
      color: "#FFFFFF",
      weight: 2.5,
      fillColor: azul,
      fillOpacity: 1,
      interactive: false,
    }).addTo(capaUsuario);
  }

  return {
    map,
    fijarClave(clave) {
      claveMapa = clave || "";
      aplicarTiles(temaActual);
    },
    aplicarTema(tema) {
      aplicarTiles(tema);
    },
    pintarParadas,
    resaltarParada,
    dibujarLinea,
    dibujarRuta,
    dibujarViaje,
    limpiarTrazado,
    limpiarRuta,
    fijarUbicacion,
    centrarEn(lat, lon, zoom = 15) {
      map.setView([lat, lon], zoom, { animate: true });
    },
    invalidar() {
      requestAnimationFrame(() => map.invalidateSize());
    },
  };
}
