// badabus PWA — main controller.

import { t, idioma, fijarIdioma, etiquetaDia } from "./i18n.js";
import {
  leerTema,
  guardarTema,
  leerFavoritas,
  alternarFavorita,
  leerLugares,
  leerParadaActiva,
  guardarParadaActiva,
  leerAvisoParadas,
  guardarAvisoParadas,
  leerRecientes,
  guardarReciente,
  leerRutasFavoritas,
  alternarRutaFavorita,
  eliminarRutaFavorita,
} from "./storage.js";
import { crearMapa, distanciaKm, indicesDeTramo } from "./mapa.js";
import {
  el,
  icono,
  badgeLinea,
  etiquetaLinea,
  claveRuta,
  renderInicio,
  renderMapLinePills,
  renderMapStopSheet,
  renderDetalleRuta,
  renderEnRuta,
  renderLineas,
  renderDetalleLinea,
  renderParadas,
  renderDetalleParada,
  renderTripBanner,
} from "./vistas.js";

const INTERVALO_REFRESCO_MS = 25000;
const DISTANCIA_LLEGADA_PARADA_KM = 0.14;
const DISTANCIA_MISMO_SITIO_KM = 0.15;
const VENTANA_SALTO_PARADAS = 3;
const INTERVALO_RENDER_GPS_MS = 5000;

const estado = {
  // Network data
  paradas: [],
  paradaPorId: {},
  lineas: {},
  ordenLineas: [],
  red: {},
  shapes: {},
  dias: {},
  tipoDia: null,
  activas: new Set(),
  cartoKey: "",

  // Navigation: "inicio" | "lineas" | "paradas" | "mapa"
  tab: "inicio",
  subInicio: "landing", // "landing" | "detalle" | "enruta"
  paradaDetalleId: null,
  paradaVolverA: null,
  lineaDetalleCod: null,
  editandoRutasFav: false,

  // Planner state (inline results on Inicio)
  origen: null,
  destino: null,
  planOrigen: null,
  planDestino: null,
  planSeq: 0,
  origenTexto: "",
  destinoTexto: "",
  plan: null,
  cargandoPlan: false,
  errorPlan: null,
  rutaIdx: 0,
  tramosAbiertos: new Set(),

  // Live arrivals & location
  tiemposCache: {},
  tiemposCargando: new Set(),
  tiemposError: new Set(),
  ubicacion: null,

  // User data (localStorage)
  tema: leerTema(),
  favoritas: leerFavoritas(),
  rutasFavoritas: leerRutasFavoritas(),
  lugares: leerLugares(),
  recientes: leerRecientes(),
  avisoParadas: leerAvisoParadas(),

  // Filters
  filtroParadas: "todas",
  consultaParadas: "",
  filtroLineas: "hoy",
  consultaLineas: "",

  // Active live trip
  viaje: null,
  watchId: null,
  audioCtx: null,
  ultimoRenderGps: 0,

  // Dedicated Map tab
  mapa: null,
  mapaFiltroLinea: "",
  mapaModo: "todo", // "todo" | "linea" | "ruta" | "viaje"
  mapaPayload: null,
  mapaVolver: null, // { label, fn }
  mapaParadaId: null,

  // Debounce timers
  acTimers: { origen: null, destino: null },
  acSeq: { origen: 0, destino: 0 },
};

const dom = {
  offlineBar: document.getElementById("offline-bar"),
  btnBrand: document.getElementById("btn-brand"),
  statusPillText: document.getElementById("status-pill-text"),
  btnLang: document.getElementById("btn-lang"),
  btnTheme: document.getElementById("btn-theme"),
  tripBanner: document.getElementById("trip-banner"),
  pageView: document.getElementById("page-view"),
  mapView: document.getElementById("map-view"),
  mapReturnBar: document.getElementById("map-return-bar"),
  mapSearchInput: document.getElementById("map-search-input"),
  mapSearchMenu: document.getElementById("map-search-menu"),
  mapLinePills: document.getElementById("map-line-pills"),
  btnMapLocate: document.getElementById("btn-map-locate"),
  btnMapNearest: document.getElementById("btn-map-nearest"),
  mapStopSheet: document.getElementById("map-stop-sheet"),
  toast: document.getElementById("toast"),
};

let toastTimer = null;

function normalizarTexto(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function mostrarToast(texto) {
  if (!dom.toast) return;
  dom.toast.textContent = texto;
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, 2600);
}

function claveNatural(cod) {
  const m = String(cod || "").match(/^([A-Za-z]*)(\d+)(.*)$/);
  if (m) return [m[1] ? 1 : 0, m[1], Number(m[2]), m[3]];
  return [2, String(cod || ""), 0, ""];
}

function ordenarLineas(codigos) {
  return codigos.slice().sort((a, b) => {
    const ka = claveNatural(a);
    const kb = claveNatural(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
}

function secuenciaDeTramo(tramo) {
  const seq = estado.red[tramo.linea] || [];
  const indices = indicesDeTramo(seq, tramo.subir, tramo.bajar);
  if (indices) return seq.slice(indices[0], indices[1] + 1).map(String);
  return [String(tramo.subir), String(tramo.bajar)];
}

/* =========================================================================
   DATA LOADING & LIVE ARRIVALS
   ========================================================================= */
async function cargarRed() {
  const [paradas, lineas, red, shapes, dias] = await Promise.all([
    fetch("/data/paradas.json").then((r) => r.json()),
    fetch("/data/lineas.json").then((r) => r.json()),
    fetch("/data/red.json").then((r) => r.json()),
    fetch("/data/shapes.json").then((r) => r.json()),
    fetch("/data/dias.json").then((r) => r.json()).catch(() => ({})),
  ]);

  estado.paradas = Array.isArray(paradas) ? paradas.map((p) => ({ ...p, id: String(p.id) })) : [];
  estado.paradaPorId = {};
  for (const p of estado.paradas) estado.paradaPorId[p.id] = p;
  estado.lineas = lineas || {};
  estado.ordenLineas = ordenarLineas(Object.keys(estado.lineas));
  estado.red = red || {};
  estado.shapes = shapes || {};
  estado.dias = dias || {};

  // Pick initial selected stop for the Map tab
  const guardada = leerParadaActiva();
  if (guardada && estado.paradaPorId[guardada]) {
    estado.mapaParadaId = guardada;
  } else if (estado.favoritas[0] && estado.paradaPorId[estado.favoritas[0]]) {
    estado.mapaParadaId = estado.favoritas[0];
  } else if (estado.paradaPorId["201"]) {
    estado.mapaParadaId = "201";
  } else if (estado.paradas[0]) {
    estado.mapaParadaId = estado.paradas[0].id;
  }
}

async function cargarConfigYDia() {
  const [cfg, diaRes] = await Promise.all([
    fetch("/api/config").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    fetch("/api/dia").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  if (cfg?.carto_key) {
    estado.cartoKey = cfg.carto_key;
    if (estado.mapa) estado.mapa.fijarClave(estado.cartoKey);
  }

  let tipo = diaRes?.tipo_dia;
  if (!tipo) {
    const dow = new Date().getDay();
    tipo = dow === 0 ? "DOM" : dow === 6 ? "SAB" : "LV";
  }
  estado.tipoDia = tipo;
  const listaDia = estado.dias[tipo];
  estado.activas = new Set(Array.isArray(listaDia) && listaDia.length ? listaDia : estado.ordenLineas);
}

async function cargarTiemposParada(id, { silencioso = false } = {}) {
  const pid = String(id || "");
  if (!pid || estado.tiemposCargando.has(pid)) return;
  estado.tiemposCargando.add(pid);
  if (!silencioso) {
    estado.tiemposError.delete(pid);
    if (estado.tab === "mapa" && estado.mapaParadaId === pid) actualizarHojaMapa();
  }
  try {
    const resp = await fetch(`/api/parada/${encodeURIComponent(pid)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    estado.tiemposCache[pid] = Array.isArray(data) ? data : [];
    estado.tiemposError.delete(pid);
  } catch {
    if (!silencioso || !estado.tiemposCache[pid]) {
      estado.tiemposError.add(pid);
    }
  } finally {
    estado.tiemposCargando.delete(pid);
    const activo = document.activeElement;
    const escribiendo = activo && (activo.id === "inp-origen" || activo.id === "inp-destino" || activo.id === "map-search-input");
    if (estado.tab === "mapa" && estado.mapaParadaId === pid) {
      actualizarHojaMapa();
    } else if (!escribiendo) {
      renderizar();
    }
  }
}

function obtenerParadasCercanas(limite = 3) {
  if (estado.ubicacion) {
    return estado.paradas
      .map((p) => ({
        parada: p,
        km: distanciaKm([estado.ubicacion.lat, estado.ubicacion.lon], [p.lat, p.lon]),
      }))
      .sort((a, b) => a.km - b.km)
      .slice(0, limite);
  }
  // Without GPS yet: show a few major central stops (e.g. #201, #200, #212 if present)
  const fallbackIds = ["201", "212", "199", "200"];
  const picked = fallbackIds.map((id) => estado.paradaPorId[id]).filter(Boolean);
  const base = picked.length ? picked : estado.paradas.slice(0, limite);
  return base.slice(0, limite).map((parada) => ({ parada, km: null }));
}

function refrescarVisibles() {
  if (document.hidden) return;
  if (estado.tab === "mapa" && estado.mapaParadaId) {
    cargarTiemposParada(estado.mapaParadaId, { silencioso: true });
    return;
  }
  if (estado.tab === "paradas" && estado.paradaDetalleId) {
    cargarTiemposParada(estado.paradaDetalleId, { silencioso: true });
    return;
  }
  if (estado.tab === "inicio" && estado.subInicio === "landing") {
    // Keep background burst <= 4 stops so we never trigger the upstream ~8-req rate limit.
    const ids = new Set();
    for (const fid of estado.favoritas.slice(0, 2)) ids.add(fid);
    for (const item of obtenerParadasCercanas(3)) {
      if (ids.size < 4) ids.add(item.parada.id);
    }
    for (const id of ids) cargarTiemposParada(id, { silencioso: true });
  }
}

/* =========================================================================
   GEOLOCATION
   ========================================================================= */
function paradaMasCercana(lat, lon) {
  let mejor = null;
  let mejorD = Infinity;
  for (const p of estado.paradas) {
    const d = distanciaKm([lat, lon], [p.lat, p.lon]);
    if (d < mejorD) {
      mejorD = d;
      mejor = p;
    }
  }
  return mejor;
}

function pedirUbicacion({
  comoOrigen = false,
  soloSiVacio = false,
  centrarMapa = false,
  seleccionarCercanaEnMapa = false,
  silencioso = false,
  alTerminar = null,
} = {}) {
  if (!navigator.geolocation) {
    if (!silencioso) mostrarToast(t("toast_gps_error"));
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      estado.ubicacion = { lat, lon };
      const cercana = paradaMasCercana(lat, lon);
      if (cercana && (!estado.mapaParadaId || seleccionarCercanaEnMapa)) {
        estado.mapaParadaId = cercana.id;
        guardarParadaActiva(cercana.id);
        cargarTiemposParada(cercana.id, { silencioso: true });
      }
      const escribiendo =
        document.activeElement &&
        (document.activeElement.id === "inp-origen" || document.activeElement.id === "inp-destino");
      const puedeRellenarOrigen =
        comoOrigen && (!soloSiVacio || (!estado.origenTexto.trim() && document.activeElement?.id !== "inp-origen"));
      if (puedeRellenarOrigen) {
        const label = cercana ? t("mi_ubicacion_cerca", { lugar: cercana.nombre }) : t("mi_ubicacion");
        estado.origen = { tipo: "gps", lat, lon, nombre: label };
        estado.origenTexto = label;
        const inp = document.getElementById("inp-origen");
        if (inp) inp.value = label;
      }
      if (estado.mapa) {
        estado.mapa.fijarUbicacion(lat, lon);
        if (seleccionarCercanaEnMapa && cercana) {
          estado.mapa.resaltarParada(cercana.id, new Set(estado.favoritas), estado.mapaFiltroLinea);
          estado.mapa.centrarEn(cercana.lat, cercana.lon, 16);
          actualizarHojaMapa();
        } else if (centrarMapa) {
          estado.mapa.centrarEn(lat, lon, 16);
        }
      }
      refrescarVisibles();
      if (!escribiendo) renderizar();
      if (alTerminar) alTerminar({ lat, lon, cercana });
    },
    () => {
      if (!silencioso) mostrarToast(t("toast_gps_error"));
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

/* =========================================================================
   INLINE AUTOCOMPLETE (PLANNER + MAP SEARCH)
   ========================================================================= */
function buscarParadasLocales(texto, limite = 5) {
  const q = normalizarTexto(texto.trim());
  if (!q) return [];
  const exactas = [];
  const parciales = [];
  for (const p of estado.paradas) {
    const nom = normalizarTexto(p.nombre);
    const idStr = String(p.id);
    if (idStr === q || nom.startsWith(q)) exactas.push(p);
    else if (nom.includes(q) || idStr.includes(q)) parciales.push(p);
  }
  return [...exactas, ...parciales].slice(0, limite);
}

function cerrarMenusAutocomplete() {
  for (const [menuId, inpId] of [
    ["ac-origen", "inp-origen"],
    ["ac-destino", "inp-destino"],
  ]) {
    const m = document.getElementById(menuId);
    if (m) m.hidden = true;
    const inp = document.getElementById(inpId);
    if (inp) inp.setAttribute("aria-expanded", "false");
  }
  if (dom.mapSearchMenu) dom.mapSearchMenu.hidden = true;
}

function seleccionarExtremo(campo, punto) {
  estado[campo] = punto;
  estado[`${campo}Texto`] = punto.nombre;
  const inp = document.getElementById(campo === "origen" ? "inp-origen" : "inp-destino");
  if (inp) inp.value = punto.nombre;
  cerrarMenusAutocomplete();
  if (campo === "origen" && !estado.destinoTexto) {
    document.getElementById("inp-destino")?.focus();
  }
}

function pintarAutocomplete(campo, texto, calles = [], buscandoCalles = false) {
  const menu = document.getElementById(campo === "origen" ? "ac-origen" : "ac-destino");
  if (!menu) return;
  const q = normalizarTexto(texto.trim());
  const items = [];

  if (campo === "origen" && (!q || normalizarTexto(t("mi_ubicacion")).includes(q))) {
    items.push(
      el(
        "button",
        {
          type: "button",
          className: "ac-item",
          onMousedown: (e) => {
            e.preventDefault();
            cerrarMenusAutocomplete();
            pedirUbicacion({ comoOrigen: true });
          },
        },
        icono("gps", "ico ico-sm"),
        el("div", {}, el("div", { className: "ac-title", text: t("mi_ubicacion") }))
      )
    );
  }

  const lugMatch = estado.lugares.filter((l) => !q || normalizarTexto(l.nombre).includes(q));
  if (lugMatch.length) {
    items.push(el("div", { className: "ac-group", text: t("sug_lugares") }));
    for (const l of lugMatch.slice(0, 4)) {
      items.push(
        el(
          "button",
          {
            type: "button",
            className: "ac-item",
            onMousedown: (e) => {
              e.preventDefault();
              seleccionarExtremo(campo, {
                tipo: l.paradaId ? "parada" : "coord",
                id: l.paradaId || undefined,
                lat: l.lat,
                lon: l.lon,
                nombre: l.nombre,
              });
            },
          },
          el(
            "div",
            {},
            el("div", { className: "ac-title", text: l.nombre }),
            l.subtitulo ? el("div", { className: "ac-sub", text: l.subtitulo }) : null
          )
        )
      );
    }
  }

  const recMatch = estado.recientes.filter((r) => !q || normalizarTexto(r.nombre).includes(q));
  if (recMatch.length) {
    items.push(el("div", { className: "ac-group", text: t("sug_recientes") }));
    for (const r of recMatch.slice(0, 4)) {
      items.push(
        el(
          "button",
          {
            type: "button",
            className: "ac-item",
            onMousedown: (e) => {
              e.preventDefault();
              seleccionarExtremo(campo, { tipo: r.tipo, id: r.id, lat: r.lat, lon: r.lon, nombre: r.nombre });
            },
          },
          el(
            "div",
            {},
            el("div", { className: "ac-title", text: r.nombre }),
            r.id ? el("div", { className: "ac-sub", text: t("parada_num", { id: r.id }) }) : null
          )
        )
      );
    }
  }

  if (!q) {
    const favObjs = estado.favoritas.map((id) => estado.paradaPorId[id]).filter(Boolean).slice(0, 3);
    if (favObjs.length) {
      items.push(el("div", { className: "ac-group", text: t("sug_favoritas") }));
      for (const p of favObjs) {
        items.push(
          el(
            "button",
            {
              type: "button",
              className: "ac-item",
              onMousedown: (e) => {
                e.preventDefault();
                seleccionarExtremo(campo, { tipo: "parada", id: p.id, lat: p.lat, lon: p.lon, nombre: p.nombre });
              },
            },
            el(
              "div",
              { style: { minWidth: "0", flex: "1" } },
              el("div", { className: "ac-title", text: p.nombre }),
              el("div", { className: "ac-sub", text: t("parada_num", { id: p.id }) })
            ),
            el("div", { style: { display: "flex", gap: "4px" } }, (p.lineas || []).slice(0, 3).map((c) => badgeLinea(c, estado.lineas, { small: true })))
          )
        );
      }
    }
    if (campo === "origen" && estado.ubicacion) {
      const cercanas = obtenerParadasCercanas(3);
      if (cercanas.length) {
        items.push(el("div", { className: "ac-group", text: t("sug_cercanas") }));
        for (const { parada: p } of cercanas) {
          items.push(
            el(
              "button",
              {
                type: "button",
                className: "ac-item",
                onMousedown: (e) => {
                  e.preventDefault();
                  seleccionarExtremo(campo, { tipo: "parada", id: p.id, lat: p.lat, lon: p.lon, nombre: p.nombre });
                },
              },
              el(
                "div",
                { style: { minWidth: "0", flex: "1" } },
                el("div", { className: "ac-title", text: p.nombre }),
                el("div", { className: "ac-sub", text: t("parada_num", { id: p.id }) })
              )
            )
          );
        }
      }
    }
  } else {
    const paradasMatch = buscarParadasLocales(texto, 5);
    if (paradasMatch.length) {
      items.push(el("div", { className: "ac-group", text: t("sug_paradas") }));
      for (const p of paradasMatch) {
        items.push(
          el(
            "button",
            {
              type: "button",
              className: "ac-item",
              onMousedown: (e) => {
                e.preventDefault();
                seleccionarExtremo(campo, { tipo: "parada", id: p.id, lat: p.lat, lon: p.lon, nombre: p.nombre });
              },
            },
            el(
              "div",
              { style: { minWidth: "0", flex: "1" } },
              el("div", { className: "ac-title", text: p.nombre }),
              el("div", { className: "ac-sub", text: t("parada_num", { id: p.id }) })
            ),
            el("div", { style: { display: "flex", gap: "4px" } }, (p.lineas || []).slice(0, 3).map((c) => badgeLinea(c, estado.lineas, { small: true })))
          )
        );
      }
    }
  }

  if (buscandoCalles) {
    items.push(el("div", { className: "ac-group", text: t("sug_calles") }));
    items.push(el("div", { className: "ac-empty", text: t("sug_buscando") }));
  } else if (calles.length) {
    items.push(el("div", { className: "ac-group", text: t("sug_calles") }));
    for (const c of calles.slice(0, 4)) {
      const corto = String(c.nombre || "").split(",").slice(0, 2).join(", ").trim() || c.nombre;
      items.push(
        el(
          "button",
          {
            type: "button",
            className: "ac-item",
            onMousedown: (e) => {
              e.preventDefault();
              seleccionarExtremo(campo, { tipo: "coord", lat: c.lat, lon: c.lon, nombre: corto });
            },
          },
          el("div", {}, el("div", { className: "ac-title", text: corto }), el("div", { className: "ac-sub", text: c.nombre }))
        )
      );
    }
  }

  menu.replaceChildren(...items);
  menu.hidden = items.length === 0;
  const inp = document.getElementById(campo === "origen" ? "inp-origen" : "inp-destino");
  if (inp) inp.setAttribute("aria-expanded", String(!menu.hidden));
}

function dispararAutocomplete(campo, texto) {
  pintarAutocomplete(campo, texto, [], texto.trim().length >= 3);
  clearTimeout(estado.acTimers[campo]);
  if (texto.trim().length < 3) return;
  const seq = ++estado.acSeq[campo];
  estado.acTimers[campo] = setTimeout(async () => {
    try {
      const resp = await fetch(`/api/buscar?q=${encodeURIComponent(texto.trim())}`);
      if (!resp.ok || seq !== estado.acSeq[campo]) return;
      const calles = await resp.json();
      if (seq !== estado.acSeq[campo]) return;
      const inp = document.getElementById(campo === "origen" ? "inp-origen" : "inp-destino");
      if (document.activeElement === inp) {
        pintarAutocomplete(campo, texto, Array.isArray(calles) ? calles : [], false);
      }
    } catch {
      if (seq === estado.acSeq[campo]) pintarAutocomplete(campo, texto, [], false);
    }
  }, 260);
}

function pintarBusquedaMapa(texto) {
  const q = normalizarTexto(texto.trim());
  if (!q) {
    dom.mapSearchMenu.hidden = true;
    return;
  }
  const items = [];
  const lins = estado.ordenLineas.filter(
    (c) => normalizarTexto(c).includes(q) || normalizarTexto(etiquetaLinea(c)).includes(q) || normalizarTexto(estado.lineas[c]?.nombre).includes(q)
  );
  if (lins.length) {
    items.push(el("div", { className: "ac-group", text: t("sug_lineas") }));
    for (const cod of lins.slice(0, 4)) {
      items.push(
        el(
          "button",
          {
            type: "button",
            className: "ac-item",
            onMousedown: (e) => {
              e.preventDefault();
              dom.mapSearchInput.value = "";
              dom.mapSearchMenu.hidden = true;
              filtrarLineaEnMapa(cod);
            },
          },
          badgeLinea(cod, estado.lineas, { small: true }),
          el("div", {}, el("div", { className: "ac-title", text: estado.lineas[cod]?.nombre || cod }))
        )
      );
    }
  }
  const paradas = buscarParadasLocales(texto, 6);
  if (paradas.length) {
    items.push(el("div", { className: "ac-group", text: t("sug_paradas") }));
    for (const p of paradas) {
      items.push(
        el(
          "button",
          {
            type: "button",
            className: "ac-item",
            onMousedown: (e) => {
              e.preventDefault();
              dom.mapSearchInput.value = "";
              dom.mapSearchMenu.hidden = true;
              seleccionarParadaEnMapa(p, { centrar: true });
            },
          },
          el(
            "div",
            { style: { minWidth: "0", flex: "1" } },
            el("div", { className: "ac-title", text: p.nombre }),
            el("div", { className: "ac-sub", text: t("parada_num", { id: p.id }) })
          )
        )
      );
    }
  }
  dom.mapSearchMenu.replaceChildren(...items);
  dom.mapSearchMenu.hidden = items.length === 0;
}

async function resolverExtremoSiTexto(campo) {
  if (estado[campo]) return estado[campo];
  const txt = (estado[`${campo}Texto`] || "").trim();
  if (!txt) return null;

  const lug = estado.lugares.find((l) => normalizarTexto(l.nombre) === normalizarTexto(txt));
  if (lug) {
    estado[campo] = {
      tipo: lug.paradaId ? "parada" : "coord",
      id: lug.paradaId || undefined,
      lat: lug.lat,
      lon: lug.lon,
      nombre: lug.nombre,
    };
    return estado[campo];
  }

  const paradas = buscarParadasLocales(txt, 1);
  if (paradas.length) {
    const p = paradas[0];
    estado[campo] = { tipo: "parada", id: p.id, lat: p.lat, lon: p.lon, nombre: p.nombre };
    estado[`${campo}Texto`] = p.nombre;
    return estado[campo];
  }

  try {
    const resp = await fetch(`/api/buscar?q=${encodeURIComponent(txt)}`);
    if (resp.ok) {
      const sitios = await resp.json();
      if (Array.isArray(sitios) && sitios[0]) {
        const s = sitios[0];
        const corto = String(s.nombre || "").split(",").slice(0, 2).join(", ").trim() || s.nombre;
        estado[campo] = { tipo: "coord", lat: s.lat, lon: s.lon, nombre: corto };
        estado[`${campo}Texto`] = corto;
        return estado[campo];
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/* =========================================================================
   ROUTE PLANNING (INLINE ON INICIO)
   ========================================================================= */
async function ejecutarPlanificacion() {
  cerrarMenusAutocomplete();
  const seq = ++estado.planSeq;

  if (!estado.origen && !estado.origenTexto.trim() && (estado.destino || estado.destinoTexto.trim())) {
    if (estado.ubicacion) {
      estado.origen = { tipo: "gps", lat: estado.ubicacion.lat, lon: estado.ubicacion.lon, nombre: t("mi_ubicacion") };
      estado.origenTexto = t("mi_ubicacion");
    } else if (estado.mapaParadaId && estado.paradaPorId[estado.mapaParadaId]) {
      const p = estado.paradaPorId[estado.mapaParadaId];
      estado.origen = { tipo: "parada", id: p.id, lat: p.lat, lon: p.lon, nombre: p.nombre };
      estado.origenTexto = p.nombre;
    }
  }

  estado.tab = "inicio";
  estado.subInicio = "landing";
  estado.cargandoPlan = true;
  estado.errorPlan = null;
  renderizar();

  const [orig, dest] = await Promise.all([resolverExtremoSiTexto("origen"), resolverExtremoSiTexto("destino")]);
  if (seq !== estado.planSeq) return;
  if (!orig || !dest) {
    estado.cargandoPlan = false;
    mostrarToast(t("completa_origen_destino"));
    renderizar();
    return;
  }

  estado.planOrigen = { ...orig };
  estado.planDestino = { ...dest };
  estado.tramosAbiertos.clear();

  // Short-circuit trivial same-location / <150 m trips locally.
  const mismoId = orig.tipo === "parada" && dest.tipo === "parada" && orig.id && orig.id === dest.id;
  const distKm =
    Number.isFinite(orig.lat) && Number.isFinite(orig.lon) && Number.isFinite(dest.lat) && Number.isFinite(dest.lon)
      ? distanciaKm([orig.lat, orig.lon], [dest.lat, dest.lon])
      : null;
  if (mismoId || (distKm !== null && distKm < DISTANCIA_MISMO_SITIO_KM)) {
    estado.plan = {
      rutas: [],
      aviso: "ya_estas_ahi",
      a_pie: distKm !== null ? { minutos: Math.round((distKm * 1.3 / 4.5) * 60), metros: Math.round(distKm * 1300) } : null,
    };
    estado.cargandoPlan = false;
    estado.errorPlan = null;
    renderizar();
    return;
  }

  estado.recientes = guardarReciente(dest);
  estado.plan = null;
  renderizar();

  const qs = new URLSearchParams();
  if (orig.tipo === "parada" && orig.id) qs.set("origen", orig.id);
  else {
    qs.set("origen_lat", String(orig.lat));
    qs.set("origen_lon", String(orig.lon));
  }
  if (dest.tipo === "parada" && dest.id) qs.set("destino", dest.id);
  else {
    qs.set("destino_lat", String(dest.lat));
    qs.set("destino_lon", String(dest.lon));
  }

  try {
    const resp = await fetch(`/api/plan?${qs.toString()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (seq !== estado.planSeq) return;
    estado.plan = data;
    estado.errorPlan = null;
  } catch {
    if (seq !== estado.planSeq) return;
    estado.errorPlan = t("error_tiempos");
  } finally {
    if (seq === estado.planSeq) {
      estado.cargandoPlan = false;
      renderizar();
    }
  }
}

function lanzarRutaFavorita(rf) {
  estado.destino = rf.destino ? { ...rf.destino } : null;
  estado.destinoTexto = rf.destino?.nombre || "";
  if (rf.origen?.tipo === "gps") {
    if (estado.ubicacion) {
      const cercana = paradaMasCercana(estado.ubicacion.lat, estado.ubicacion.lon);
      const label = cercana ? t("mi_ubicacion_cerca", { lugar: cercana.nombre }) : t("mi_ubicacion");
      estado.origen = { tipo: "gps", lat: estado.ubicacion.lat, lon: estado.ubicacion.lon, nombre: label };
      estado.origenTexto = label;
      ejecutarPlanificacion();
    } else {
      pedirUbicacion({
        comoOrigen: true,
        alTerminar: () => ejecutarPlanificacion(),
      });
    }
    return;
  }
  estado.origen = rf.origen ? { ...rf.origen } : null;
  estado.origenTexto = rf.origen?.nombre || "";
  ejecutarPlanificacion();
}

/* =========================================================================
   LIVE TRIP ("EN RUTA") + DROP-OFF ALARM
   ========================================================================= */
function desbloquearAudio() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!estado.audioCtx || estado.audioCtx.state === "closed") {
      estado.audioCtx = new AudioCtx();
    }
    if (estado.audioCtx.state === "suspended") {
      estado.audioCtx.resume().catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

function cerrarAudio() {
  if (estado.audioCtx && estado.audioCtx.state !== "closed") {
    estado.audioCtx.close().catch(() => {});
  }
  estado.audioCtx = null;
}

function reproducirAvisoSonoro() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = estado.audioCtx && estado.audioCtx.state !== "closed" ? estado.audioCtx : new AudioCtx();
    estado.audioCtx = ctx;
    const tocar = () => {
      const ahora = ctx.currentTime;
      [587.33, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ahora + i * 0.16);
        gain.gain.setValueAtTime(0.001, ahora + i * 0.16);
        gain.gain.exponentialRampToValueAtTime(0.16, ahora + i * 0.16 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, ahora + i * 0.16 + 0.24);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ahora + i * 0.16);
        osc.stop(ahora + i * 0.16 + 0.26);
      });
    };
    if (ctx.state === "suspended") ctx.resume().then(tocar).catch(() => {});
    else tocar();
  } catch {
    /* ignore */
  }
}

function dispararAlertaBajada(nombreParada) {
  if (navigator.vibrate) navigator.vibrate([220, 110, 220, 110, 320]);
  reproducirAvisoSonoro();
  const msg = t("toast_noti_bajada", { parada: nombreParada });
  mostrarToast(msg);
  if ("Notification" in window && Notification.permission === "granted") {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification("badabus", { body: msg, icon: "/icon-192.png" }))
        .catch(() => {
          try {
            new Notification("badabus", { body: msg, icon: "/icon-192.png" });
          } catch {
            /* ignore */
          }
        });
    } else {
      try {
        new Notification("badabus", { body: msg, icon: "/icon-192.png" });
      } catch {
        /* ignore */
      }
    }
  }
}

function comprobarAlertaViaje() {
  const v = estado.viaje;
  if (!v || v.alertaDisparada) return;
  const faltan = Math.max(0, v.paradas.length - 1 - v.idxActual);
  if (faltan <= v.avisoParadas) {
    v.alertaDisparada = true;
    const idBajar = v.paradas[v.paradas.length - 1];
    dispararAlertaBajada(estado.paradaPorId[idBajar]?.nombre || `#${idBajar}`);
  }
}

function detenerGpsViaje() {
  if (estado.watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(estado.watchId);
  }
  estado.watchId = null;
}

function arrancarGpsViaje() {
  detenerGpsViaje();
  if (!navigator.geolocation || !estado.viaje) {
    if (estado.viaje) estado.viaje.gpsEstado = "error";
    return;
  }
  estado.viaje.gpsEstado = "esperando";
  estado.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      estado.ubicacion = { lat, lon };
      if (estado.mapa) estado.mapa.fijarUbicacion(lat, lon);
      const v = estado.viaje;
      if (!v) return;
      const cambioEstado = v.gpsEstado !== "activo";
      v.gpsEstado = "activo";
      let mejorIdx = v.idxActual;
      let mejorD = DISTANCIA_LLEGADA_PARADA_KM;
      const topeIdx = Math.min(v.paradas.length, v.idxActual + VENTANA_SALTO_PARADAS + 1);
      for (let i = v.idxActual; i < topeIdx; i++) {
        const p = estado.paradaPorId[v.paradas[i]];
        if (!p) continue;
        const d = distanciaKm([lat, lon], [p.lat, p.lon]);
        if (d < mejorD) {
          mejorD = d;
          mejorIdx = i;
        }
      }
      const avanzo = mejorIdx > v.idxActual;
      if (avanzo) {
        v.idxActual = mejorIdx;
        comprobarAlertaViaje();
        if (estado.tab === "mapa" && estado.mapaModo === "viaje" && estado.mapa) {
          estado.mapa.dibujarViaje(v, {
            shapes: estado.shapes,
            lineas: estado.lineas,
            red: estado.red,
            paradaPorId: estado.paradaPorId,
          });
        }
      }
      const viendoEnRuta = estado.tab === "inicio" && estado.subInicio === "enruta";
      const ahora = Date.now();
      if (avanzo || cambioEstado) {
        if (viendoEnRuta) {
          estado.ultimoRenderGps = ahora;
          renderizar();
        } else {
          actualizarChrome();
        }
      } else if (viendoEnRuta && ahora - estado.ultimoRenderGps >= INTERVALO_RENDER_GPS_MS) {
        estado.ultimoRenderGps = ahora;
        renderizar();
      }
    },
    () => {
      if (estado.viaje && estado.viaje.gpsEstado !== "error") {
        estado.viaje.gpsEstado = "error";
        if (estado.tab === "inicio" && estado.subInicio === "enruta") renderizar();
      }
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
  );
}

function iniciarViaje(ruta) {
  if (!ruta?.tramos?.length) return;
  desbloquearAudio();
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
  const tramo = ruta.tramos[0];
  estado.viaje = {
    ruta,
    tramoIdx: 0,
    linea: tramo.linea,
    paradas: secuenciaDeTramo(tramo),
    idxActual: 0,
    avisoParadas: estado.avisoParadas,
    alertaDisparada: false,
    gpsEstado: "esperando",
    destinoNombre: estado.planDestino?.nombre || estado.destino?.nombre || estado.destinoTexto || "",
  };
  estado.ultimoRenderGps = 0;
  estado.tab = "inicio";
  estado.subInicio = "enruta";
  arrancarGpsViaje();
  comprobarAlertaViaje();
  renderizar();
}

function avanzarTramoViaje() {
  const v = estado.viaje;
  if (!v) return;
  const sigIdx = v.tramoIdx + 1;
  if (sigIdx >= v.ruta.tramos.length) {
    finalizarViaje();
    return;
  }
  const tramo = v.ruta.tramos[sigIdx];
  v.tramoIdx = sigIdx;
  v.linea = tramo.linea;
  v.paradas = secuenciaDeTramo(tramo);
  v.idxActual = 0;
  v.alertaDisparada = false;
  comprobarAlertaViaje();
  renderizar();
}

function finalizarViaje() {
  detenerGpsViaje();
  cerrarAudio();
  estado.viaje = null;
  if (estado.tab === "inicio" && estado.subInicio === "enruta") estado.subInicio = "landing";
  if (estado.mapaModo === "viaje") {
    estado.mapaModo = "todo";
    estado.mapaPayload = null;
    estado.mapaVolver = null;
  }
  renderizar();
}

/* =========================================================================
   DEDICATED MAP TAB (SEARCH + LINE PILLS + LEAFLET + STOP ARRIVALS SHEET)
   ========================================================================= */
function asegurarMapa() {
  if (estado.mapa || !window.L) return;
  estado.mapa = crearMapa("map", {
    onStopClick: (parada) => seleccionarParadaEnMapa(parada, { centrar: false }),
  });
  if (estado.cartoKey) estado.mapa.fijarClave(estado.cartoKey);
  if (estado.ubicacion) estado.mapa.fijarUbicacion(estado.ubicacion.lat, estado.ubicacion.lon);
}

function seleccionarParadaEnMapa(parada, { centrar = false } = {}) {
  if (!parada) return;
  const p = estado.paradaPorId[String(parada.id)] || parada;
  estado.mapaParadaId = String(p.id);
  guardarParadaActiva(p.id);
  if (estado.mapa) {
    estado.mapa.resaltarParada(p.id, new Set(estado.favoritas), estado.mapaFiltroLinea);
    if (centrar && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
      estado.mapa.centrarEn(p.lat, p.lon, 16);
    }
  }
  cargarTiemposParada(p.id);
  actualizarHojaMapa();
}

function filtrarLineaEnMapa(cod) {
  estado.mapaFiltroLinea = cod || "";
  estado.mapaModo = cod ? "linea" : "todo";
  estado.mapaPayload = cod || null;
  estado.mapaVolver = null;
  sincronizarMapa();
}

function actualizarHojaMapa() {
  const p = estado.mapaParadaId ? estado.paradaPorId[estado.mapaParadaId] : null;
  renderMapStopSheet(
    dom.mapStopSheet,
    {
      parada: p,
      esFav: p ? estado.favoritas.includes(p.id) : false,
      llegadas: p ? estado.tiemposCache[p.id] : null,
      cargando: p ? estado.tiemposCargando.has(p.id) : false,
      error: p ? estado.tiemposError.has(p.id) : false,
      ubicacion: estado.ubicacion,
      lineas: estado.lineas,
    },
    {
      onAlternarFavorita: (id) => {
        const agregada = alternarFavorita(id);
        estado.favoritas = leerFavoritas();
        mostrarToast(agregada ? t("toast_favorita_si") : t("toast_favorita_no"));
        if (estado.mapa) {
          estado.mapa.pintarParadas(estado.paradas, {
            favoritas: new Set(estado.favoritas),
            activaId: estado.mapaParadaId,
            filtroLinea: estado.mapaFiltroLinea,
          });
        }
        actualizarHojaMapa();
      },
      onRecargar: (id) => cargarTiemposParada(id),
      onFiltrarLinea: (cod) => filtrarLineaEnMapa(cod),
      onSalirDesde: (parada) => {
        estado.origen = { tipo: "parada", id: parada.id, lat: parada.lat, lon: parada.lon, nombre: parada.nombre };
        estado.origenTexto = parada.nombre;
        estado.tab = "inicio";
        estado.subInicio = "landing";
        renderizar();
        document.getElementById("inp-destino")?.focus();
      },
      onComoLlegar: (parada) => {
        estado.destino = { tipo: "parada", id: parada.id, lat: parada.lat, lon: parada.lon, nombre: parada.nombre };
        estado.destinoTexto = parada.nombre;
        ejecutarPlanificacion();
      },
    }
  );
}

function sincronizarMapa() {
  asegurarMapa();
  dom.mapSearchInput.placeholder = t("mapa_buscar_ph");
  dom.btnMapLocate.setAttribute("aria-label", t("mapa_centrar_gps"));
  dom.btnMapNearest.setAttribute("aria-label", t("mapa_parada_cercana"));

  renderMapLinePills(
    dom.mapLinePills,
    {
      ordenLineas: estado.ordenLineas,
      activas: estado.activas,
      lineas: estado.lineas,
      filtroLinea: estado.mapaFiltroLinea,
    },
    filtrarLineaEnMapa
  );

  // Return bar when opened from a route, line detail, or active trip
  if (estado.mapaVolver) {
    dom.mapReturnBar.hidden = false;
    dom.mapReturnBar.replaceChildren(
      el("button", { type: "button", className: "band-back", onClick: estado.mapaVolver.fn }, icono("back", "ico ico-sm"), el("span", { text: estado.mapaVolver.label })),
      el("button", {
        type: "button",
        className: "sec-link",
        text: t("limpiar_mapa"),
        onClick: () => {
          estado.mapaModo = "todo";
          estado.mapaFiltroLinea = "";
          estado.mapaPayload = null;
          estado.mapaVolver = null;
          sincronizarMapa();
        },
      })
    );
  } else {
    dom.mapReturnBar.hidden = true;
  }

  if (!estado.mapa) return;
  estado.mapa.invalidar();
  estado.mapa.limpiarTrazado();
  estado.mapa.limpiarRuta();

  const favSet = new Set(estado.favoritas);
  if (estado.mapaModo === "linea" && estado.mapaPayload) {
    const cod = estado.mapaPayload;
    estado.mapa.pintarParadas(estado.paradas, { favoritas: favSet, activaId: estado.mapaParadaId, filtroLinea: cod });
    estado.mapa.dibujarLinea(cod, estado.shapes, estado.lineas, { ajustar: true });
  } else if (estado.mapaModo === "ruta" && estado.mapaPayload) {
    estado.mapa.pintarParadas(estado.paradas, { favoritas: favSet, activaId: estado.mapaParadaId });
    estado.mapa.dibujarRuta(estado.mapaPayload, {
      origenCoord: estado.origen?.lat ? [estado.origen.lat, estado.origen.lon] : null,
      destinoCoord: estado.destino?.lat ? [estado.destino.lat, estado.destino.lon] : null,
      shapes: estado.shapes,
      lineas: estado.lineas,
      red: estado.red,
      paradaPorId: estado.paradaPorId,
    });
  } else if (estado.mapaModo === "viaje" && estado.viaje) {
    estado.mapa.pintarParadas(estado.paradas, { favoritas: favSet, activaId: estado.mapaParadaId });
    estado.mapa.dibujarViaje(estado.viaje, {
      shapes: estado.shapes,
      lineas: estado.lineas,
      red: estado.red,
      paradaPorId: estado.paradaPorId,
    });
  } else {
    estado.mapa.pintarParadas(estado.paradas, { favoritas: favSet, activaId: estado.mapaParadaId });
    const pSel = estado.mapaParadaId ? estado.paradaPorId[estado.mapaParadaId] : null;
    if (pSel) estado.mapa.centrarEn(pSel.lat, pSel.lon, 15);
  }

  if (estado.mapaParadaId) cargarTiemposParada(estado.mapaParadaId, { silencioso: Boolean(estado.tiemposCache[estado.mapaParadaId]) });
  actualizarHojaMapa();
}

function abrirParadaEnMapa(parada) {
  if (!parada) return;
  const p = estado.paradaPorId[String(parada.id)] || parada;
  estado.tab = "mapa";
  estado.mapaParadaId = String(p.id);
  estado.mapaModo = "todo";
  estado.mapaFiltroLinea = "";
  estado.mapaPayload = null;
  estado.mapaVolver = null;
  guardarParadaActiva(p.id);
  renderizar();
  sincronizarMapa();
}

function abrirMapaCon(modo, payload, volver = null) {
  estado.tab = "mapa";
  estado.mapaModo = modo;
  estado.mapaFiltroLinea = modo === "linea" ? payload : "";
  estado.mapaPayload = payload;
  estado.mapaVolver = volver;
  renderizar();
  sincronizarMapa();
}

/* =========================================================================
   NAVIGATION & SAVED PLACES MODAL
   ========================================================================= */
function abrirParada(id) {
  const pid = String(id || "");
  if (!estado.paradaPorId[pid]) return;
  estado.paradaVolverA = {
    tab: estado.tab,
    subInicio: estado.subInicio,
    lineaDetalleCod: estado.lineaDetalleCod,
  };
  estado.paradaDetalleId = pid;
  estado.tab = "paradas";
  guardarParadaActiva(pid);
  cargarTiemposParada(pid);
  renderizar();
}

function cambiarTab(nuevaTab) {
  estado.tab = nuevaTab;
  if (nuevaTab === "inicio") {
    estado.lineaDetalleCod = null;
    estado.paradaDetalleId = null;
  } else if (nuevaTab === "lineas") {
    estado.lineaDetalleCod = null;
    estado.paradaDetalleId = null;
  } else if (nuevaTab === "paradas") {
    estado.paradaDetalleId = null;
    estado.lineaDetalleCod = null;
    if (estado.favoritas.length && estado.filtroParadas === "todas" && !estado.consultaParadas) {
      estado.filtroParadas = "favoritas";
    }
  }
  renderizar();
  if (nuevaTab === "mapa") sincronizarMapa();
}

/* =========================================================================
   MAIN RENDER
   ========================================================================= */
function actualizarChrome() {
  const esOscuro = estado.tema === "oscuro";
  dom.btnTheme.textContent = esOscuro ? t("tema_claro") : t("tema_oscuro");
  dom.btnLang.textContent = idioma() === "es" ? "EN" : "ES";
  dom.btnLang.setAttribute("aria-label", t("cambiar_idioma"));
  dom.offlineBar.textContent = t("offline");
  dom.offlineBar.hidden = navigator.onLine;
  dom.statusPillText.textContent = estado.tipoDia ? `${etiquetaDia(estado.tipoDia)} · ${estado.activas.size}` : t("red_normal");

  const etiquetasNav = {
    inicio: t("nav_inicio"),
    lineas: t("nav_lineas"),
    paradas: t("nav_paradas"),
    mapa: t("nav_mapa"),
  };
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    const k = btn.dataset.nav;
    const activo = estado.tab === k;
    btn.classList.toggle("is-active", activo);
    if (activo) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
    const span = btn.querySelector("[data-i18n]");
    if (span) span.textContent = etiquetasNav[k];
    else btn.textContent = etiquetasNav[k];
  });

  const viendoEnRuta = estado.tab === "inicio" && estado.subInicio === "enruta";
  renderTripBanner(
    dom.tripBanner,
    estado.viaje && !viendoEnRuta ? estado.viaje : null,
    estado.paradaPorId,
    () => {
      estado.tab = "inicio";
      estado.subInicio = "enruta";
      renderizar();
    }
  );
}

function renderizar({ preservarFocoId = null } = {}) {
  let focoId = preservarFocoId;
  let selStart = null;
  let selEnd = null;
  if (!focoId && document.activeElement && (document.activeElement.id === "inp-buscar-parada" || document.activeElement.id === "inp-buscar-linea")) {
    focoId = document.activeElement.id;
    selStart = document.activeElement.selectionStart;
    selEnd = document.activeElement.selectionEnd;
  }

  actualizarChrome();

  if (estado.tab === "mapa") {
    dom.pageView.hidden = true;
    dom.mapView.hidden = false;
    return;
  }

  dom.mapView.hidden = true;
  dom.pageView.hidden = false;

  if (estado.tab === "lineas" && estado.lineaDetalleCod) {
    renderDetalleLinea(
      dom.pageView,
      {
        codigo: estado.lineaDetalleCod,
        lineas: estado.lineas,
        red: estado.red,
        paradaPorId: estado.paradaPorId,
        activas: estado.activas,
      },
      {
        onVolver: () => {
          estado.lineaDetalleCod = null;
          renderizar();
        },
        onVerLineaEnMapa: (cod) =>
          abrirMapaCon("linea", cod, {
            label: t("volver"),
            fn: () => {
              estado.tab = "lineas";
              estado.lineaDetalleCod = cod;
              renderizar();
            },
          }),
        onAbrirParadaEnMapa: abrirParadaEnMapa,
      }
    );
  } else if (estado.tab === "lineas") {
    renderLineas(
      dom.pageView,
      {
        lineas: estado.lineas,
        ordenLineas: estado.ordenLineas,
        activas: estado.activas,
        tipoDia: estado.tipoDia,
        filtroLineas: estado.filtroLineas,
        consultaLineas: estado.consultaLineas,
        red: estado.red,
      },
      {
        onBuscarLinea: (val) => {
          estado.consultaLineas = val;
          renderizar({ preservarFocoId: "inp-buscar-linea" });
        },
        onFiltroLineas: (f) => {
          estado.filtroLineas = f;
          renderizar();
        },
        onAbrirLinea: (cod) => {
          estado.lineaDetalleCod = cod;
          renderizar();
        },
      }
    );
  } else if (estado.tab === "paradas" && estado.paradaDetalleId && estado.paradaPorId[estado.paradaDetalleId]) {
    const pid = estado.paradaDetalleId;
    renderDetalleParada(
      dom.pageView,
      {
        parada: estado.paradaPorId[pid],
        esFav: estado.favoritas.includes(pid),
        llegadas: estado.tiemposCache[pid],
        cargando: estado.tiemposCargando.has(pid),
        error: estado.tiemposError.has(pid),
        ubicacion: estado.ubicacion,
        lineas: estado.lineas,
      },
      {
        onVolver: () => {
          const v = estado.paradaVolverA;
          estado.paradaDetalleId = null;
          if (v && v.tab !== "paradas") {
            estado.tab = v.tab;
            estado.subInicio = v.subInicio || "landing";
            estado.lineaDetalleCod = v.lineaDetalleCod || null;
          }
          renderizar();
          if (estado.tab === "mapa") sincronizarMapa();
        },
        onAlternarFavorita: (id) => {
          const agregada = alternarFavorita(id);
          estado.favoritas = leerFavoritas();
          mostrarToast(agregada ? t("toast_favorita_si") : t("toast_favorita_no"));
          renderizar();
        },
        onVerParadaEnMapa: (p) => abrirParadaEnMapa(p),
        onRecargar: (id) => cargarTiemposParada(id),
        onAbrirLinea: (cod) => {
          estado.paradaDetalleId = null;
          estado.lineaDetalleCod = cod;
          estado.tab = "lineas";
          renderizar();
        },
        onSalirDesde: (parada) => {
          estado.origen = { tipo: "parada", id: parada.id, lat: parada.lat, lon: parada.lon, nombre: parada.nombre };
          estado.origenTexto = parada.nombre;
          estado.paradaDetalleId = null;
          estado.tab = "inicio";
          estado.subInicio = "landing";
          renderizar();
          document.getElementById("inp-destino")?.focus();
        },
        onComoLlegar: (parada) => {
          estado.destino = { tipo: "parada", id: parada.id, lat: parada.lat, lon: parada.lon, nombre: parada.nombre };
          estado.destinoTexto = parada.nombre;
          estado.paradaDetalleId = null;
          ejecutarPlanificacion();
        },
      }
    );
  } else if (estado.tab === "paradas") {
    renderParadas(
      dom.pageView,
      {
        paradas: estado.paradas,
        favoritasSet: new Set(estado.favoritas),
        filtroParadas: estado.filtroParadas,
        consultaParadas: estado.consultaParadas,
        ubicacion: estado.ubicacion,
        tiemposCache: estado.tiemposCache,
        lineas: estado.lineas,
      },
      {
        onBuscarParada: (val) => {
          estado.consultaParadas = val;
          if (val.trim() && estado.filtroParadas === "favoritas") estado.filtroParadas = "todas";
          renderizar({ preservarFocoId: "inp-buscar-parada" });
        },
        onFiltroParadas: (f) => {
          estado.filtroParadas = f;
          if (f === "cercanas" && !estado.ubicacion) pedirUbicacion();
          renderizar();
        },
        onAbrirParada: abrirParada,
        onAlternarFavorita: (id) => {
          const agregada = alternarFavorita(id);
          estado.favoritas = leerFavoritas();
          mostrarToast(agregada ? t("toast_favorita_si") : t("toast_favorita_no"));
          renderizar();
        },
      }
    );
  } else if (estado.subInicio === "enruta" && estado.viaje) {
    renderEnRuta(
      dom.pageView,
      {
        viaje: estado.viaje,
        paradaPorId: estado.paradaPorId,
        lineas: estado.lineas,
        ubicacion: estado.ubicacion,
      },
      {
        onFinalizarViaje: finalizarViaje,
        onCambiarAviso: (n) => {
          estado.avisoParadas = guardarAvisoParadas(n);
          if (estado.viaje) {
            estado.viaje.avisoParadas = estado.avisoParadas;
            const faltan = Math.max(0, estado.viaje.paradas.length - 1 - estado.viaje.idxActual);
            if (faltan > estado.viaje.avisoParadas) {
              estado.viaje.alertaDisparada = false;
            } else if (!estado.viaje.alertaDisparada) {
              comprobarAlertaViaje();
            }
          }
          renderizar();
        },
        onAvanzarParada: () => {
          if (!estado.viaje) return;
          if (estado.viaje.idxActual < estado.viaje.paradas.length - 1) {
            estado.viaje.idxActual += 1;
            comprobarAlertaViaje();
            renderizar();
          }
        },
        onSiguienteTramo: avanzarTramoViaje,
        onVerViajeEnMapa: () =>
          abrirMapaCon("viaje", estado.viaje, {
            label: t("volver_viaje"),
            fn: () => {
              estado.tab = "inicio";
              estado.subInicio = "enruta";
              renderizar();
            },
          }),
      }
    );
  } else if (estado.subInicio === "detalle" && estado.plan?.rutas?.[estado.rutaIdx]) {
    const ruta = estado.plan.rutas[estado.rutaIdx];
    renderDetalleRuta(
      dom.pageView,
      {
        ruta,
        origenNombre: estado.origen?.nombre || estado.origenTexto,
        destinoNombre: estado.destino?.nombre || estado.destinoTexto,
        paradaPorId: estado.paradaPorId,
        red: estado.red,
        lineas: estado.lineas,
        tramosAbiertos: estado.tramosAbiertos,
      },
      {
        onVolver: () => {
          estado.subInicio = "landing";
          renderizar();
        },
        onIniciarViaje: () => iniciarViaje(ruta),
        onVerRutaEnMapa: () =>
          abrirMapaCon("ruta", ruta, {
            label: t("volver_ruta"),
            fn: () => {
              estado.tab = "inicio";
              estado.subInicio = "detalle";
              renderizar();
            },
          }),
        onAlternarParadasTramo: (ti) => {
          if (estado.tramosAbiertos.has(ti)) estado.tramosAbiertos.delete(ti);
          else estado.tramosAbiertos.add(ti);
          renderizar();
        },
      }
    );
  } else {
    renderInicio(
      dom.pageView,
      {
        origen: estado.planOrigen || estado.origen,
        destino: estado.planDestino || estado.destino,
        origenTexto: estado.origenTexto,
        destinoTexto: estado.destinoTexto,
        plan: estado.plan,
        cargandoPlan: estado.cargandoPlan,
        errorPlan: estado.errorPlan,
        rutasFavoritas: estado.rutasFavoritas,
        editandoRutasFav: estado.editandoRutasFav,
        favoritas: estado.favoritas,
        paradasCercanas: obtenerParadasCercanas(3),
        ubicacion: estado.ubicacion,
        paradaPorId: estado.paradaPorId,
        tiemposCache: estado.tiemposCache,
        lineas: estado.lineas,
        red: estado.red,
      },
      {
        onInputExtremo: (campo, valor) => {
          estado[`${campo}Texto`] = valor;
          estado[campo] = null;
          dispararAutocomplete(campo, valor);
        },
        onFocusExtremo: (campo) => {
          cerrarMenusAutocomplete();
          pintarAutocomplete(campo, estado[`${campo}Texto`] || "", [], false);
        },
        onEnterExtremo: (campo) => {
          if (campo === "origen" && !estado.destinoTexto.trim()) {
            cerrarMenusAutocomplete();
            document.getElementById("inp-destino")?.focus();
          } else {
            ejecutarPlanificacion();
          }
        },
        onUsarGpsOrigen: () => pedirUbicacion({ comoOrigen: true }),
        onLimpiarDestino: () => {
          estado.destino = null;
          estado.destinoTexto = "";
          renderizar();
          document.getElementById("inp-destino")?.focus();
        },
        onIntercambiar: () => {
          const tmpObj = estado.origen;
          const tmpTxt = estado.origenTexto;
          estado.origen = estado.destino;
          estado.origenTexto = estado.destinoTexto;
          estado.destino = tmpObj;
          estado.destinoTexto = tmpTxt;
          renderizar();
        },
        onBuscarRuta: ejecutarPlanificacion,
        onElegirRuta: (idx) => {
          estado.rutaIdx = idx;
          estado.tramosAbiertos.clear();
          estado.subInicio = "detalle";
          renderizar();
        },
        onAlternarRutaFavorita: (ruta) => {
          const orig = estado.planOrigen || estado.origen;
          const dest = estado.planDestino || estado.destino;
          if (!orig || !dest) return;
          const origGuardar =
            orig.tipo === "gps"
              ? { tipo: "gps", nombre: t("mi_ubicacion") }
              : { ...orig };
          const cortoO = orig.tipo === "gps" ? t("mi_ubicacion") : String(orig.nombre || "").split(",")[0].trim();
          const cortoD = String(dest.nombre || "").split(",")[0].trim();
          const res = alternarRutaFavorita({
            clave: claveRuta(orig, dest, ruta),
            titulo: `${cortoO} → ${cortoD}`,
            lineas: (ruta.tramos || []).map((tr) => tr.linea),
            origen: origGuardar,
            destino: { ...dest },
            totalMin: ruta.total_min,
          });
          estado.rutasFavoritas = res.lista;
          mostrarToast(res.guardada ? t("toast_ruta_si") : t("toast_ruta_no"));
          renderizar();
        },
        onLanzarRutaFavorita: lanzarRutaFavorita,
        onAlternarEditarRutasFav: () => {
          estado.editandoRutasFav = !estado.editandoRutasFav;
          renderizar();
        },
        onEliminarRutaFavorita: (clave) => {
          estado.rutasFavoritas = eliminarRutaFavorita(clave);
          if (!estado.rutasFavoritas.length) estado.editandoRutasFav = false;
          mostrarToast(t("toast_ruta_no"));
          renderizar();
        },
        onAbrirParada: abrirParada,
        onAlternarFavorita: (id) => {
          const agregada = alternarFavorita(id);
          estado.favoritas = leerFavoritas();
          mostrarToast(agregada ? t("toast_favorita_si") : t("toast_favorita_no"));
          renderizar();
        },
        onPedirGps: () => pedirUbicacion({ comoOrigen: !estado.origenTexto }),
        onIrTab: cambiarTab,
      }
    );
  }

  if (focoId) {
    const inp = document.getElementById(focoId);
    if (inp) {
      inp.focus();
      if (selStart !== null && selEnd !== null) {
        try {
          inp.setSelectionRange(selStart, selEnd);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/* =========================================================================
   EVENT BINDING & BOOTSTRAP
   ========================================================================= */
function enlazarEventosGlobales() {
  dom.btnBrand.addEventListener("click", () => {
    estado.subInicio = "landing";
    cambiarTab("inicio");
  });

  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => cambiarTab(btn.dataset.nav));
  });

  dom.btnTheme.addEventListener("click", () => {
    estado.tema = guardarTema(estado.tema === "oscuro" ? "claro" : "oscuro");
    if (estado.mapa) estado.mapa.aplicarTema(estado.tema);
    renderizar();
  });

  dom.btnLang.addEventListener("click", () => {
    fijarIdioma(idioma() === "es" ? "en" : "es");
    renderizar();
    if (estado.tab === "mapa") sincronizarMapa();
  });

  // Dedicated Map controls
  dom.mapSearchInput.addEventListener("input", () => pintarBusquedaMapa(dom.mapSearchInput.value));
  dom.mapSearchInput.addEventListener("focus", () => pintarBusquedaMapa(dom.mapSearchInput.value));
  dom.btnMapLocate.addEventListener("click", () => pedirUbicacion({ centrarMapa: true }));
  dom.btnMapNearest.addEventListener("click", () => pedirUbicacion({ seleccionarCercanaEnMapa: true }));

  document.addEventListener("click", (ev) => {
    if (!ev.target.closest(".field-wrap")) cerrarMenusAutocomplete();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cerrarMenusAutocomplete();
  });

  window.addEventListener("online", actualizarChrome);
  window.addEventListener("offline", actualizarChrome);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refrescarVisibles();
  });
}

async function iniciar() {
  guardarTema(estado.tema);
  enlazarEventosGlobales();
  renderizar();

  try {
    await cargarRed();
    await cargarConfigYDia();
  } catch (err) {
    console.error("Error cargando red:", err);
  }

  renderizar();
  refrescarVisibles();

  if (navigator.permissions?.query) {
    navigator.permissions
      .query({ name: "geolocation" })
      .then((res) => {
        if (res.state === "granted") pedirUbicacion({ comoOrigen: true, soloSiVacio: true, silencioso: true });
      })
      .catch(() => {});
  }

  setInterval(refrescarVisibles, INTERVALO_REFRESCO_MS);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

iniciar();
