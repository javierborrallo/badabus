// Local-only device storage (no accounts): favorites, saved places, theme, preferences.

const CLAVE_FAVORITAS = "badabus_favoritas_v1";
const CLAVE_LUGARES = "badabus_lugares_v1";
const CLAVE_PARADA_ACTIVA = "badabus_parada_activa_v1";
const CLAVE_AVISO_PARADAS = "badabus_aviso_paradas_v1";
const CLAVE_RECIENTES = "badabus_recientes_v1";
const CLAVE_RUTAS_FAV = "badabus_rutas_fav_v1";

function leerJson(clave, defecto) {
  try {
    const raw = localStorage.getItem(clave);
    return raw ? JSON.parse(raw) : defecto;
  } catch {
    return defecto;
  }
}

function guardarJson(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    /* quota or private mode */
  }
}

export function leerTema() {
  try {
    const g = localStorage.getItem("tema");
    if (g === "claro" || g === "oscuro") return g;
  } catch {
    /* ignore */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
}

export function guardarTema(tema) {
  const val = tema === "oscuro" ? "oscuro" : "claro";
  document.documentElement.dataset.theme = val;
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute("content", val === "oscuro" ? "#0E233A" : "#0B2A4A");
  }
  try {
    localStorage.setItem("tema", val);
  } catch {
    /* ignore */
  }
  return val;
}

export function leerFavoritas() {
  const lista = leerJson(CLAVE_FAVORITAS, []);
  return Array.isArray(lista) ? lista.map(String) : [];
}

export function esFavorita(paradaId) {
  return leerFavoritas().includes(String(paradaId));
}

export function alternarFavorita(paradaId) {
  const id = String(paradaId);
  const lista = leerFavoritas();
  const idx = lista.indexOf(id);
  if (idx >= 0) {
    lista.splice(idx, 1);
  } else {
    lista.unshift(id);
  }
  guardarJson(CLAVE_FAVORITAS, lista);
  return idx < 0;
}

export function leerLugares() {
  const lista = leerJson(CLAVE_LUGARES, []);
  return Array.isArray(lista) ? lista : [];
}

export function guardarLugar(lugar) {
  const lista = leerLugares();
  const nuevo = {
    id: lugar.id || `lug_${Date.now()}`,
    nombre: String(lugar.nombre || "").trim().slice(0, 28),
    icono: lugar.icono || "pin",
    lat: Number(lugar.lat),
    lon: Number(lugar.lon),
    paradaId: lugar.paradaId ? String(lugar.paradaId) : null,
    subtitulo: String(lugar.subtitulo || "").trim(),
  };
  if (!nuevo.nombre || !Number.isFinite(nuevo.lat) || !Number.isFinite(nuevo.lon)) {
    return lista;
  }
  const idx = lista.findIndex((x) => x.id === nuevo.id);
  if (idx >= 0) lista[idx] = nuevo;
  else lista.push(nuevo);
  guardarJson(CLAVE_LUGARES, lista);
  return lista;
}

export function eliminarLugar(id) {
  const lista = leerLugares().filter((x) => x.id !== id);
  guardarJson(CLAVE_LUGARES, lista);
  return lista;
}

export function leerParadaActiva() {
  try {
    return localStorage.getItem(CLAVE_PARADA_ACTIVA) || "";
  } catch {
    return "";
  }
}

export function guardarParadaActiva(paradaId) {
  try {
    localStorage.setItem(CLAVE_PARADA_ACTIVA, String(paradaId));
  } catch {
    /* ignore */
  }
}

export function leerAvisoParadas() {
  try {
    const v = Number(localStorage.getItem(CLAVE_AVISO_PARADAS));
    return v === 2 ? 2 : 1;
  } catch {
    return 1;
  }
}

export function guardarAvisoParadas(n) {
  const val = n === 2 ? 2 : 1;
  try {
    localStorage.setItem(CLAVE_AVISO_PARADAS, String(val));
  } catch {
    /* ignore */
  }
  return val;
}

export function leerRecientes() {
  const lista = leerJson(CLAVE_RECIENTES, []);
  return Array.isArray(lista) ? lista : [];
}

export function guardarReciente(punto) {
  if (!punto || !punto.nombre) return leerRecientes();
  const clave = punto.tipo === "parada" && punto.id ? `p:${punto.id}` : `c:${punto.nombre}`;
  const entrada = {
    clave,
    tipo: punto.tipo === "parada" ? "parada" : "coord",
    id: punto.id ? String(punto.id) : undefined,
    lat: Number(punto.lat),
    lon: Number(punto.lon),
    nombre: String(punto.nombre).trim(),
  };
  const lista = leerRecientes().filter((x) => x.clave !== clave);
  lista.unshift(entrada);
  const recortada = lista.slice(0, 5);
  guardarJson(CLAVE_RECIENTES, recortada);
  return recortada;
}

export function leerRutasFavoritas() {
  const lista = leerJson(CLAVE_RUTAS_FAV, []);
  return Array.isArray(lista) ? lista : [];
}

export function alternarRutaFavorita(entrada) {
  if (!entrada || !entrada.clave) return { guardada: false, lista: leerRutasFavoritas() };
  const lista = leerRutasFavoritas();
  const idx = lista.findIndex((x) => x.clave === entrada.clave);
  if (idx >= 0) {
    lista.splice(idx, 1);
    guardarJson(CLAVE_RUTAS_FAV, lista);
    return { guardada: false, lista };
  }
  lista.unshift({
    clave: String(entrada.clave),
    titulo: String(entrada.titulo || "").trim(),
    lineas: Array.isArray(entrada.lineas) ? entrada.lineas.map(String) : [],
    origen: entrada.origen,
    destino: entrada.destino,
    totalMin: Number.isFinite(entrada.totalMin) ? Math.round(entrada.totalMin) : null,
  });
  const recortada = lista.slice(0, 8);
  guardarJson(CLAVE_RUTAS_FAV, recortada);
  return { guardada: true, lista: recortada };
}

export function eliminarRutaFavorita(clave) {
  const lista = leerRutasFavoritas().filter((x) => x.clave !== clave);
  guardarJson(CLAVE_RUTAS_FAV, lista);
  return lista;
}
