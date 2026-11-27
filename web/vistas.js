// Safe DOM renderers for badabus PWA.

import { t, etiquetaDia } from "./i18n.js";
import { colorSeguro, distanciaKm, indicesDeTramo } from "./mapa.js";

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "className") node.className = v;
    else if (k === "text") node.textContent = String(v);
    else if (k === "dataset") {
      for (const [dk, dv] of Object.entries(v)) {
        if (dv !== undefined && dv !== null) node.dataset[dk] = String(dv);
      }
    } else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "style" && typeof v === "object") {
      Object.assign(node.style, v);
    } else if (v === true) {
      node.setAttribute(k, "");
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(
      typeof child === "string" || typeof child === "number"
        ? document.createTextNode(String(child))
        : child
    );
  }
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function icono(nombre, clase = "ico", filled = false) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", clase);
  svg.setAttribute("aria-hidden", "true");
  const defs = {
    back: [["path", { d: "m15 18-6-6 6-6" }]],
    swap: [["path", { d: "M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" }]],
    gps: [
      ["circle", { cx: "12", cy: "12", r: "3" }],
      ["path", { d: "M12 2v3m0 14v3M2 12h3m14 0h3" }],
    ],
    pin: [
      ["path", { d: "M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10Z" }],
      ["circle", { cx: "12", cy: "11", r: "2" }],
    ],
    clock: [
      ["circle", { cx: "12", cy: "12", r: "9" }],
      ["path", { d: "M12 7v5l3 2" }],
    ],
    bus: [
      ["rect", { x: "4", y: "3", width: "16", height: "14", rx: "3" }],
      ["path", { d: "M4 11h16M8 17v2m8-2v2" }],
      ["circle", { cx: "8", cy: "14", r: "1", fill: "currentColor" }],
      ["circle", { cx: "16", cy: "14", r: "1", fill: "currentColor" }],
    ],
    walk: [
      ["circle", { cx: "13", cy: "4", r: "1.8" }],
      ["path", { d: "m10 21 2-6 3 2v4m-5-11 2-2 3 2 2-1m-5 1-2 5-3 3" }],
    ],
    clear: [["path", { d: "M18 6 6 18M6 6l12 12" }]],
    search: [
      ["circle", { cx: "11", cy: "11", r: "7" }],
      ["path", { d: "m20 20-3.5-3.5" }],
    ],
    nav: [["polygon", { points: "3 11 22 2 13 21 11 13 3 11" }]],
    map: [
      ["path", { d: "m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z" }],
      ["path", { d: "M9 4v14M15 6v14" }],
    ],
    bell: [
      ["path", { d: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" }],
      ["path", { d: "M10.3 21a1.94 1.94 0 0 0 3.4 0" }],
    ],
    star: [["polygon", { points: "12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.7 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2" }]],
    bookmark: [["path", { d: "M6 4h12a1 1 0 0 1 1 1v16l-7-4-7 4V5a1 1 0 0 1 1-1Z" }]],
    arrow: [["path", { d: "M5 12h14m-5-5 5 5-5 5" }]],
    hail: [
      ["circle", { cx: "12", cy: "4.5", r: "1.8" }],
      ["path", { d: "M12 8v6m0 0-2 6m2-6 2 6M8 10l4-1 4-4" }],
    ],
    card: [
      ["rect", { x: "2.5", y: "5", width: "19", height: "14", rx: "2.5" }],
      ["path", { d: "M2.5 10h19M6.5 15h4" }],
    ],
    phone: [
      ["rect", { x: "6", y: "2.5", width: "12", height: "19", rx: "2.5" }],
      ["path", { d: "M10.5 18h3" }],
    ],
  };
  for (const [tag, attrs] of defs[nombre] || []) {
    const p = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
    if (filled && (nombre === "star" || nombre === "bookmark")) p.setAttribute("fill", "currentColor");
    svg.appendChild(p);
  }
  return svg;
}

export function codigoLinea(texto) {
  const s = String(texto || "").trim();
  const m = s.match(/L[ÍI]NEA\s+([A-Z0-9]+)/i);
  if (m) return m[1].toUpperCase();
  return s.toUpperCase();
}

export function etiquetaLinea(codigo) {
  const cod = codigoLinea(codigo);
  return /^\d+$/.test(cod) ? `L${cod}` : cod;
}

export function parsearMinutos(texto) {
  const s = String(texto || "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("parada") || s.includes("llegando") || s.includes("inminente")) return 0;
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

export function formatearDistancia(km) {
  if (!Number.isFinite(km)) return "";
  const m = Math.round(km * 1000);
  if (m < 1000) return t("a_dist_m", { n: m });
  return t("a_dist_km", { n: (m / 1000).toFixed(1).replace(".", ",") });
}

export function formatearMetros(metros) {
  if (!Number.isFinite(metros) || metros < 0) return "";
  if (metros < 1000) return `${Math.round(metros)} m`;
  return `${(metros / 1000).toFixed(1).replace(".", ",")} km`;
}

export function badgeLinea(codigo, lineas, { small = false } = {}) {
  const cod = codigoLinea(codigo);
  const bg = colorSeguro(lineas[cod]?.color);
  return el("span", {
    className: small ? "l-badge l-badge-sm" : "l-badge",
    style: { backgroundColor: bg },
    text: etiquetaLinea(cod),
  });
}

function secuenciaTramo(tramo, red) {
  const seq = red[tramo.linea] || [];
  const indices = indicesDeTramo(seq, tramo.subir, tramo.bajar);
  if (indices) return seq.slice(indices[0], indices[1] + 1).map(String);
  return [String(tramo.subir), String(tramo.bajar)];
}

function horaReloj(offsetMin = 0) {
  const d = new Date(Date.now() + offsetMin * 60000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function normalizarLlegadas(lista, lineas) {
  return (lista || [])
    .map((item) => {
      const cod = codigoLinea(item.linea);
      const min = parsearMinutos(item.tiempo);
      return {
        cod,
        nombre: lineas[cod]?.nombre || item.linea || cod,
        min,
        raw: item.tiempo,
        metros: Number.isFinite(item.metros) ? item.metros : null,
      };
    })
    .sort((a, b) => (a.min ?? 999) - (b.min ?? 999));
}

function textoMinutos(min, raw) {
  if (min === 0) return t("ahora");
  if (Number.isFinite(min)) return t("min_corto", { n: min });
  return String(raw || "—").replace(/\.$/, "");
}

function primeraLlegadaParada(id, tiemposCache, lineas) {
  const items = normalizarLlegadas(tiemposCache[id], lineas);
  return items[0] || null;
}

export function claveRuta(origen, destino, ruta) {
  const lins = (ruta.tramos || []).map((tr) => tr.linea).join("-");
  const o = origen?.id || origen?.nombre || "";
  const d = destino?.id || destino?.nombre || "";
  return `${o}=>${d}:${lins}`;
}

export function urlAppOficial() {
  const ua = String(navigator.userAgent || "");
  if (/Android/i.test(ua)) {
    const fallback = encodeURIComponent("https://play.google.com/store/apps/details?id=com.xone.android.buskmejson");
    return `intent://#Intent;package=com.xone.android.buskmejson;S.browser_fallback_url=${fallback};end`;
  }
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return "https://apps.apple.com/es/app/id1575680694";
  }
  return "https://play.google.com/store/apps/details?id=com.xone.android.buskmejson";
}

/* =========================================================================
   1. INICIO ("BUSCAR") — Planner + Inline Mejores Rutas + Favoritas + Cercanas
   ========================================================================= */
export function renderInicio(container, ctx, cb) {
  const {
    origen,
    destino,
    origenTexto,
    destinoTexto,
    plan,
    cargandoPlan,
    errorPlan,
    rutasFavoritas,
    editandoRutasFav,
    favoritas,
    paradasCercanas,
    ubicacion,
    paradaPorId,
    tiemposCache,
    lineas,
    red,
  } = ctx;

  const favRutasSet = new Set(rutasFavoritas.map((r) => r.clave));
  const favParadasSet = new Set(favoritas);

  // 1. Page Heading + Planner Card
  const inpOrigen = el("input", {
    id: "inp-origen",
    type: "text",
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-controls": "ac-origen",
    "aria-expanded": "false",
    autocomplete: "off",
    value: origenTexto,
    placeholder: t("origen_ph"),
    onInput: (e) => cb.onInputExtremo("origen", e.target.value),
    onFocus: () => cb.onFocusExtremo("origen"),
    onKeydown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        cb.onEnterExtremo("origen");
      }
    },
  });
  const inpDestino = el("input", {
    id: "inp-destino",
    type: "text",
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-controls": "ac-destino",
    "aria-expanded": "false",
    autocomplete: "off",
    value: destinoTexto,
    placeholder: t("destino_ph"),
    onInput: (e) => cb.onInputExtremo("destino", e.target.value),
    onFocus: () => cb.onFocusExtremo("destino"),
    onKeydown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        cb.onEnterExtremo("destino");
      }
    },
  });

  const plannerSec = el(
    "section",
    { className: "sec-block" },
    el("h1", { className: "page-h1", text: t("hero_titulo") }),
    el(
      "article",
      { className: "planner-card" },
      el(
        "div",
        { className: "planner-fields" },
        el(
          "div",
          { className: "field-wrap" },
          el("label", { className: "field-label", for: "inp-origen", text: t("origen_label") }),
          el(
            "div",
            { className: "field-input-row" },
            el(
              "button",
              {
                type: "button",
                className: "ico-origin",
                title: t("mi_ubicacion"),
                "aria-label": t("mi_ubicacion"),
                onClick: cb.onUsarGpsOrigen,
              },
              icono("gps", "ico")
            ),
            inpOrigen
          ),
          el("div", { id: "ac-origen", className: "ac-menu", hidden: true })
        ),
        el(
          "button",
          {
            type: "button",
            className: "swap-float",
            title: t("intercambiar"),
            "aria-label": t("intercambiar"),
            onClick: cb.onIntercambiar,
          },
          icono("swap", "ico ico-sm")
        ),
        el(
          "div",
          { className: "field-wrap" },
          el("label", { className: "field-label", for: "inp-destino", text: t("destino_label") }),
          el(
            "div",
            { className: "field-input-row" },
            el("span", { className: "ico-dest", style: { display: "inline-flex" } }, icono("pin", "ico")),
            inpDestino,
            destinoTexto
              ? el(
                  "button",
                  {
                    type: "button",
                    className: "field-clear-btn",
                    "aria-label": t("cerrar"),
                    onClick: cb.onLimpiarDestino,
                  },
                  icono("clear", "ico ico-sm")
                )
              : null
          ),
          el("div", { id: "ac-destino", className: "ac-menu", hidden: true })
        )
      ),
      el(
        "div",
        { className: "planner-cta-row" },
        el(
          "span",
          { className: "time-pill" },
          icono("clock", "ico ico-sm"),
          el("span", { text: t("salir_ahora") })
        ),
        el(
          "button",
          {
            type: "button",
            className: "btn-primary flex-1",
            disabled: cargandoPlan,
            onClick: cb.onBuscarRuta,
          },
          icono("bus", "ico"),
          el("span", { text: cargandoPlan ? t("buscando_rutas") : t("buscar_ruta") })
        )
      )
    )
  );

  // 2. Inline "Mejores rutas" (visible as soon as a search is running or has results)
  let resultadosSec = null;
  if (cargandoPlan || plan || errorPlan) {
    const rutas = plan?.rutas || [];
    const resumen = cargandoPlan
      ? t("buscando_rutas")
      : errorPlan
        ? errorPlan
        : rutas.length === 1
          ? t("opcion_ahora_una")
          : t("opciones_ahora", { n: rutas.length });

    const cards = [];
    if (cargandoPlan) {
      cards.push(el("div", { className: "empty-card", text: t("buscando_rutas") }));
    } else if (errorPlan) {
      cards.push(
        el(
          "div",
          { className: "empty-card" },
          el("span", { text: errorPlan }),
          el("button", { type: "button", className: "btn-secondary btn-sm", text: t("reintentar"), onClick: cb.onBuscarRuta })
        )
      );
    } else if (!rutas.length) {
      const msgVacio =
        plan?.aviso === "ya_estas_ahi"
          ? plan?.a_pie?.metros > 15
            ? t("ya_estas_ahi_dist", { dist: formatearMetros(plan.a_pie.metros) })
            : t("ya_estas_ahi")
          : t("sin_rutas");
      cards.push(el("div", { className: "empty-card", text: msgVacio }));
    } else {
      rutas.forEach((ruta, idx) => {
        const tramos = ruta.tramos || [];
        const transbordos = Math.max(0, tramos.length - 1);
        const totalParadas = tramos.reduce((acc, tr) => acc + Math.max(1, secuenciaTramo(tr, red).length - 1), 0);
        const pSub = tramos[0] ? paradaPorId[tramos[0].subir] : null;
        const salidaMin = Number.isFinite(ruta.espera_min) ? Math.round(ruta.espera_min) : null;
        const totalMin = Number.isFinite(ruta.total_min) ? Math.round(ruta.total_min) : null;
        const rangoHora = totalMin !== null ? `${horaReloj(0)} – ${horaReloj(totalMin)}` : "";
        const subLinea = [rangoHora, pSub?.nombre].filter(Boolean).join(" · ");

        const badges = [];
        tramos.forEach((tr, ti) => {
          if (ti > 0) badges.push(icono("arrow", "ico ico-sm"));
          badges.push(badgeLinea(tr.linea, lineas, { small: tramos.length > 1 }));
        });

        const clave = claveRuta(origen, destino, ruta);
        const guardada = favRutasSet.has(clave);

        const pillSalida =
          salidaMin === 0
            ? el("span", { className: "pill-live mono", text: t("sale_ahora") })
            : salidaMin !== null
              ? el("span", {
                  className: salidaMin <= 6 ? "pill-live mono" : "pill-neutral mono",
                  text: t("sale_en", { min: salidaMin }),
                })
              : el("span", { className: "pill-neutral", text: t("sin_dato_vivo") });

        cards.push(
          el(
            "article",
            { className: "route-card" },
            el(
              "header",
              { className: "rc-top" },
              el(
                "div",
                { className: "rc-left" },
                el("div", { className: "rc-badges" }, ...badges),
                el(
                  "div",
                  { style: { minWidth: "0" } },
                  el("h3", {
                    className: "rc-title",
                    text:
                      transbordos === 0
                        ? `${t("directo")} · ${totalParadas === 1 ? t("parada_1") : t("paradas_n", { n: totalParadas })}`
                        : transbordos === 1
                          ? t("transbordos_1")
                          : t("transbordos_n", { n: transbordos }),
                  }),
                  el("p", { className: "rc-sub", text: subLinea })
                )
              ),
              el(
                "div",
                { className: "rc-right" },
                el("span", { className: "rc-dur", text: totalMin !== null ? t("min_corto", { n: totalMin }) : "—" }),
                el(
                  "button",
                  {
                    type: "button",
                    className: `icon-round-btn${guardada ? " is-active" : ""}`,
                    "aria-label": guardada ? t("quitar_ruta") : t("guardar_ruta"),
                    "aria-pressed": String(guardada),
                    onClick: () => cb.onAlternarRutaFavorita(ruta),
                  },
                  icono("bookmark", "ico", guardada)
                )
              )
            ),
            el(
              "div",
              { className: "rc-foot" },
              pillSalida,
              el("button", {
                type: "button",
                className: "sec-link",
                text: t("ver_paradas"),
                onClick: () => cb.onElegirRuta(idx),
              })
            )
          )
        );
      });
    }

    if (plan?.a_pie && Number.isFinite(plan.a_pie.minutos)) {
      cards.push(
        el(
          "div",
          { className: "empty-card", style: { borderStyle: "solid" } },
          el("span", {
            text: t("opcion_pie", {
              min: Math.round(plan.a_pie.minutos),
              dist: formatearMetros(plan.a_pie.metros),
            }),
          })
        )
      );
    }

    resultadosSec = el(
      "section",
      { className: "sec-block" },
      el(
        "div",
        { className: "sec-head" },
        el("h2", { className: "sec-title", text: t("mejores_rutas") }),
        el("span", { className: "sec-meta", text: resumen })
      ),
      el("div", { className: "routes-stack" }, ...cards)
    );
  }

  // 3. Favorite Routes (2-column grid with inline edit toggle)
  const favRutasSec = el(
    "section",
    { className: "sec-block" },
    el(
      "div",
      { className: "sec-head" },
      el("h2", { className: "sec-title", text: t("rutas_favoritas") }),
      rutasFavoritas.length
        ? el("button", {
            type: "button",
            className: "sec-link",
            text: editandoRutasFav ? t("listo") : t("gestionar"),
            onClick: cb.onAlternarEditarRutasFav,
          })
        : null
    ),
    rutasFavoritas.length
      ? el(
          "div",
          { className: "fav-grid" },
          rutasFavoritas.slice(0, 6).map((rf) =>
            el(
              "div",
              { className: "fav-card-wrap" },
              el(
                "button",
                {
                  type: "button",
                  className: "fav-card",
                  style: { width: "100%" },
                  onClick: () => cb.onLanzarRutaFavorita(rf),
                },
                el(
                  "div",
                  { className: "fc-top" },
                  el("span", { style: { color: "var(--on-primary-container)", display: "inline-flex" } }, icono("bookmark", "ico ico-sm", true)),
                  rf.totalMin ? el("span", { className: "fc-min is-live", text: t("min_corto", { n: rf.totalMin }) }) : null
                ),
                el(
                  "div",
                  {},
                  el("h3", { className: "fc-title", text: rf.titulo }),
                  el("p", { className: "fc-sub", text: rf.lineas.map(etiquetaLinea).join(" → ") })
                )
              ),
              editandoRutasFav
                ? el(
                    "button",
                    {
                      type: "button",
                      className: "fav-del-btn",
                      "aria-label": `${t("eliminar")} ${rf.titulo}`,
                      onClick: () => cb.onEliminarRutaFavorita(rf.clave),
                    },
                    icono("clear", "ico ico-sm")
                  )
                : null
            )
          )
        )
      : el("div", { className: "empty-card", text: t("rutas_fav_vacio") })
  );

  // 4. Favorite Stops (2-column grid)
  const favParadasObjs = favoritas.map((id) => paradaPorId[id]).filter(Boolean);
  const favParadasSec = el(
    "section",
    { className: "sec-block" },
    el(
      "div",
      { className: "sec-head" },
      el("h2", { className: "sec-title", text: t("paradas_favoritas") }),
      el("span", {
        className: "sec-meta",
        text: favParadasObjs.length === 1 ? t("guardada_1") : t("guardadas_n", { n: favParadasObjs.length }),
      })
    ),
    favParadasObjs.length
      ? el(
          "div",
          { className: "fav-grid" },
          favParadasObjs.slice(0, 4).map((p) => {
            const prim = primeraLlegadaParada(p.id, tiemposCache, lineas);
            return el(
              "button",
              {
                type: "button",
                className: "fav-card",
                onClick: () => cb.onAbrirParada(p.id),
              },
              el(
                "div",
                { className: "fc-top" },
                el("span", { style: { color: "var(--secondary)", display: "inline-flex" } }, icono("star", "ico ico-sm", true)),
                prim
                  ? el("span", {
                      className: `fc-min${prim.min !== null && prim.min <= 4 ? " is-live" : ""}`,
                      text: textoMinutos(prim.min, prim.raw),
                    })
                  : null
              ),
              el(
                "div",
                {},
                el("h3", { className: "fc-title", text: p.nombre }),
                el("p", { className: "fc-sub", text: (p.lineas || []).slice(0, 4).map(etiquetaLinea).join(", ") })
              )
            );
          })
        )
      : el("div", { className: "empty-card", text: t("favoritas_vacio") })
  );

  // 5. Nearby Stops (vertical list with live arrival + inline star toggle)
  const maxDistM =
    ubicacion && paradasCercanas.length
      ? Math.max(300, Math.ceil(paradasCercanas[paradasCercanas.length - 1].km * 1000 / 50) * 50)
      : null;

  const cercanasSec = el(
    "section",
    { className: "sec-block" },
    el(
      "div",
      { className: "sec-head" },
      el("h2", { className: "sec-title", text: t("paradas_cercanas") }),
      ubicacion && maxDistM
        ? el("span", { className: "sec-meta", text: t("menos_de_m", { n: maxDistM }) })
        : el("button", { type: "button", className: "sec-link", text: t("usar_gps"), onClick: cb.onPedirGps })
    ),
    el(
      "div",
      { className: "nearby-list" },
      paradasCercanas.map(({ parada: p, km }) => {
        const esFav = favParadasSet.has(p.id);
        const prim = primeraLlegadaParada(p.id, tiemposCache, lineas);
        const lins = (p.lineas || []).slice(0, 4).map(etiquetaLinea).join(", ");
        const sub = [km !== null ? formatearMetros(km * 1000) : t("parada_num", { id: p.id }), lins]
          .filter(Boolean)
          .join(" · ");
        return el(
          "div",
          { className: "nearby-row" },
          el(
            "button",
            {
              type: "button",
              className: "nearby-main",
              onClick: () => cb.onAbrirParada(p.id),
            },
            el("span", { style: { color: "var(--on-primary-container)", display: "inline-flex" } }, icono("hail", "ico")),
            el(
              "div",
              { style: { minWidth: "0" } },
              el("h3", { className: "nearby-title", text: p.nombre }),
              el("p", { className: "nearby-sub", text: sub })
            )
          ),
          el(
            "div",
            { className: "nearby-right" },
            prim ? el("span", { className: "nearby-min", text: textoMinutos(prim.min, prim.raw) }) : null,
            el(
              "button",
              {
                type: "button",
                className: `icon-round-btn${esFav ? " is-star" : ""}`,
                "aria-label": esFav ? t("quitar_favorita") : t("guardar_favorita"),
                "aria-pressed": String(esFav),
                onClick: () => cb.onAlternarFavorita(p.id),
              },
              icono("star", "ico", esFav)
            )
          )
        );
      })
    )
  );

  // 6. Official App Indirect Services (Bonobús & Buskme deep link)
  const hrefApp = urlAppOficial();
  const esIntent = hrefApp.startsWith("intent://");
  const linkProps = esIntent
    ? { href: hrefApp }
    : { href: hrefApp, target: "_blank", rel: "noopener noreferrer" };

  const serviciosSec = el(
    "section",
    { className: "sec-block" },
    el(
      "div",
      { className: "sec-head" },
      el("h2", { className: "sec-title", text: t("servicios_oficiales") })
    ),
    el(
      "div",
      { className: "fav-grid" },
      el(
        "a",
        { ...linkProps, className: "ext-card" },
        el("div", { className: "ext-top" }, icono("card", "ico"), el("span", { className: "ext-arrow", text: t("abrir_app") })),
        el(
          "div",
          {},
          el("h3", { className: "fc-title", text: t("bonobus_titulo") }),
          el("p", { className: "fc-sub", text: t("bonobus_sub") })
        )
      ),
      el(
        "a",
        { ...linkProps, className: "ext-card" },
        el("div", { className: "ext-top" }, icono("phone", "ico"), el("span", { className: "ext-arrow", text: t("abrir_app") })),
        el(
          "div",
          {},
          el("h3", { className: "fc-title", text: t("buskme_titulo") }),
          el("p", { className: "fc-sub", text: t("buskme_sub") })
        )
      )
    )
  );

  container.replaceChildren(
    el("div", { className: "page-inner" }, plannerSec, resultadosSec, favRutasSec, favParadasSec, cercanasSec, serviciosSec)
  );
}

/* =========================================================================
   2. MAP TAB COMPONENTS (LINE PILLS & SELECTED STOP ARRIVALS SHEET)
   ========================================================================= */
export function renderMapLinePills(container, { ordenLineas, activas, lineas, filtroLinea }, onSelect) {
  const codigos = ordenLineas.filter((c) => !activas.size || activas.has(c));
  const pills = [
    el("button", {
      type: "button",
      className: `line-pill${!filtroLinea ? " is-active" : ""}`,
      "aria-pressed": String(!filtroLinea),
      text: t("mapa_todas_paradas"),
      onClick: () => onSelect(""),
    }),
    ...codigos.map((cod) =>
      el(
        "button",
        {
          type: "button",
          className: `line-pill is-mono${filtroLinea === cod ? " is-active" : ""}`,
          "aria-pressed": String(filtroLinea === cod),
          onClick: () => onSelect(filtroLinea === cod ? "" : cod),
        },
        el("span", { className: "line-dot", style: { backgroundColor: colorSeguro(lineas[cod]?.color) } }),
        el("span", { text: etiquetaLinea(cod) })
      )
    ),
  ];
  container.replaceChildren(...pills);
}

export function renderMapStopSheet(container, ctx, cb) {
  const { parada, esFav, llegadas, cargando, error, ubicacion, lineas } = ctx;
  if (!parada) {
    container.replaceChildren();
    return;
  }

  const items = normalizarLlegadas(llegadas, lineas);
  const dist = ubicacion ? formatearDistancia(distanciaKm([ubicacion.lat, ubicacion.lon], [parada.lat, parada.lon])) : t("parada_num", { id: parada.id });
  const nLleg = items.length;
  const sub = nLleg
    ? `${dist} · ${nLleg === 1 ? t("mapa_llegando_una") : t("mapa_llegando", { n: nLleg })}`
    : dist;

  let body;
  if (cargando && !llegadas) {
    body = el("div", { className: "sec-meta", text: t("actualizando") });
  } else if (error) {
    body = el(
      "div",
      { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" } },
      el("span", { className: "sec-meta", text: t("error_tiempos") }),
      el("button", { type: "button", className: "btn-secondary btn-sm", text: t("reintentar"), onClick: () => cb.onRecargar(parada.id) })
    );
  } else if (!items.length) {
    body = el("div", { className: "sec-meta", text: t("sin_buses") });
  } else {
    body = el(
      "ul",
      { className: "arr-list" },
      items.map((it) =>
        el(
          "li",
          { className: "arr-item" },
          el(
            "div",
            { className: "arr-left" },
            el(
              "button",
              { type: "button", onClick: () => cb.onFiltrarLinea(it.cod), title: it.nombre },
              badgeLinea(it.cod, lineas, { small: true })
            ),
            el(
              "div",
              { style: { minWidth: "0" } },
              el("div", { className: "arr-dest", text: it.nombre }),
              it.metros !== null ? el("div", { className: "arr-dist", text: formatearMetros(it.metros) }) : null
            )
          ),
          it.min === 0
            ? el("span", { className: "pill-live mono", text: t("ahora") })
            : el("span", {
                className: `arr-time${it.min !== null && it.min <= 6 ? " is-soon" : ""}`,
                text: textoMinutos(it.min, it.raw),
              })
        )
      )
    );
  }

  container.replaceChildren(
    el(
      "article",
      { className: "sheet-card" },
      el(
        "header",
        { className: "sheet-head" },
        el(
          "div",
          { style: { minWidth: "0" } },
          el("h2", { className: "sheet-title", text: parada.nombre }),
          el("p", { className: "sheet-meta", text: sub })
        ),
        el(
          "button",
          {
            type: "button",
            className: `icon-round-btn${esFav ? " is-star" : ""}`,
            "aria-label": esFav ? t("quitar_favorita") : t("guardar_favorita"),
            "aria-pressed": String(esFav),
            onClick: () => cb.onAlternarFavorita(parada.id),
          },
          icono("star", "ico", esFav)
        )
      ),
      body,
      el(
        "footer",
        { className: "sheet-foot" },
        el("button", {
          type: "button",
          className: "sec-link",
          text: t("salir_desde_aqui"),
          onClick: () => cb.onSalirDesde(parada),
        }),
        el(
          "button",
          {
            type: "button",
            className: "btn-primary btn-sm",
            onClick: () => cb.onComoLlegar(parada),
          },
          icono("walk", "ico ico-sm"),
          el("span", { text: t("como_llegar") })
        )
      )
    )
  );
}

/* =========================================================================
   3. ROUTE DETAIL & EN RUTA (LIVE GPS TRIP)
   ========================================================================= */
export function renderDetalleRuta(container, ctx, cb) {
  const { ruta, origenNombre, destinoNombre, paradaPorId, red, lineas, tramosAbiertos } = ctx;
  const tramos = ruta.tramos || [];
  const transbordos = Math.max(0, tramos.length - 1);
  const totalParadas = tramos.reduce((acc, tr) => acc + Math.max(1, secuenciaTramo(tr, red).length - 1), 0);
  const llegada = Number.isFinite(ruta.total_min) ? horaReloj(ruta.total_min) : "";

  const kicker = [];
  tramos.forEach((tr, i) => {
    if (i > 0) kicker.push(el("span", { text: "→" }));
    kicker.push(badgeLinea(tr.linea, lineas, { small: true }));
  });
  kicker.push(
    el("span", {
      text:
        transbordos === 0
          ? `${t("directo")} · ${totalParadas === 1 ? t("parada_1") : t("paradas_n", { n: totalParadas })}`
          : transbordos === 1
            ? t("transbordos_1")
            : t("transbordos_n", { n: transbordos }),
    })
  );

  const subPartes = [];
  if (ruta.espera_min === 0) subPartes.push(t("sale_ahora"));
  else if (Number.isFinite(ruta.espera_min)) subPartes.push(t("sale_en", { min: Math.round(ruta.espera_min) }));
  if (llegada) subPartes.push(t("llegada_aprox", { hora: llegada }));

  const band = el(
    "section",
    { className: "sub-band" },
    el(
      "div",
      { className: "sub-band-inner" },
      el(
        "div",
        { className: "band-top" },
        el(
          "button",
          { type: "button", className: "band-back", onClick: cb.onVolver },
          icono("back", "ico ico-sm"),
          el("span", { text: t("volver_inicio") })
        ),
        el("span", {
          className: "mono",
          style: { fontSize: "15px", fontWeight: "700" },
          text: Number.isFinite(ruta.total_min) ? t("min_corto", { n: Math.round(ruta.total_min) }) : "",
        })
      ),
      el("div", { className: "band-kicker" }, ...kicker),
      el("h1", { className: "band-h1", text: `${origenNombre} → ${destinoNombre}` }),
      subPartes.length ? el("p", { className: "band-sub", text: subPartes.join(" · ") }) : null
    )
  );

  const actions = el(
    "div",
    { className: "action-bar" },
    el(
      "button",
      { type: "button", className: "btn-primary", onClick: cb.onIniciarViaje },
      icono("nav", "ico ico-sm"),
      el("span", { text: t("seguir_viaje") })
    ),
    el(
      "button",
      { type: "button", className: "btn-secondary", onClick: cb.onVerRutaEnMapa },
      icono("map", "ico ico-sm"),
      el("span", { text: t("ver_en_mapa") })
    )
  );

  const pasos = [];
  const primerSubir = tramos[0] ? paradaPorId[tramos[0].subir] : null;
  if (primerSubir && primerSubir.nombre !== origenNombre) {
    pasos.push(
      el(
        "div",
        { className: "step-row" },
        el("div", { className: "step-rail" }, el("span", { className: "step-dot" })),
        el(
          "div",
          { className: "step-body" },
          el("div", { className: "step-title", text: t("camina_a", { parada: primerSubir.nombre }) }),
          el("div", { className: "step-sub", text: t("parada_num", { id: primerSubir.id }) })
        )
      )
    );
  }

  tramos.forEach((tr, ti) => {
    const seq = secuenciaTramo(tr, red);
    const intermedias = seq.slice(1, -1);
    const pSub = paradaPorId[tr.subir];
    const pBaj = paradaPorId[tr.bajar];
    const abierto = tramosAbiertos.has(ti);
    const subDetalles = [];
    if (ti === 0 && Number.isFinite(ruta.espera_min)) {
      subDetalles.push(ruta.espera_min === 0 ? t("sale_ahora") : t("sale_en", { min: Math.round(ruta.espera_min) }));
    }
    const nPar = Math.max(1, seq.length - 1);
    subDetalles.push(nPar === 1 ? t("parada_1") : t("paradas_n", { n: nPar }));
    if (lineas[tr.linea]?.nombre) subDetalles.push(lineas[tr.linea].nombre);

    pasos.push(
      el(
        "div",
        { className: "step-row" },
        el("div", { className: "step-rail" }, el("span", { className: "step-dot bus" })),
        el(
          "div",
          { className: "step-body" },
          el(
            "div",
            { className: "step-title" },
            badgeLinea(tr.linea, lineas, { small: true }),
            el("span", { text: t("sube_en", { parada: pSub?.nombre || tr.subir }) })
          ),
          el("div", { className: "step-sub", text: subDetalles.join(" · ") }),
          intermedias.length
            ? el("button", {
                type: "button",
                className: "step-stops-toggle",
                text: abierto ? t("ocultar_paradas_tramo") : t("ver_paradas_tramo", { n: intermedias.length }),
                onClick: () => cb.onAlternarParadasTramo(ti),
              })
            : null,
          abierto && intermedias.length
            ? el(
                "div",
                { className: "step-stops-list" },
                intermedias.map((id) => el("div", { text: paradaPorId[id]?.nombre || `#${id}` }))
              )
            : null
        )
      )
    );

    const esUltimo = ti === tramos.length - 1;
    pasos.push(
      el(
        "div",
        { className: "step-row" },
        el("div", { className: "step-rail" }, el("span", { className: esUltimo ? "step-dot end" : "step-dot" })),
        el(
          "div",
          { className: "step-body" },
          el("div", { className: "step-title", text: t("baja_en", { parada: pBaj?.nombre || tr.bajar }) }),
          pBaj ? el("div", { className: "step-sub", text: t("parada_num", { id: pBaj.id }) }) : null
        )
      )
    );

    const sig = tramos[ti + 1];
    if (sig && sig.subir !== tr.bajar) {
      const pSig = paradaPorId[sig.subir];
      pasos.push(
        el(
          "div",
          { className: "step-row" },
          el("div", { className: "step-rail" }, el("span", { className: "step-dot" })),
          el(
            "div",
            { className: "step-body" },
            el("div", { className: "step-title", text: t("transbordo_en", { parada: pSig?.nombre || sig.subir }) })
          )
        )
      );
    }
  });

  const ultimoBajar = tramos[tramos.length - 1] ? paradaPorId[tramos[tramos.length - 1].bajar] : null;
  if (ultimoBajar && ultimoBajar.nombre !== destinoNombre) {
    pasos.push(
      el(
        "div",
        { className: "step-row" },
        el("div", { className: "step-rail" }, el("span", { className: "step-dot end" })),
        el(
          "div",
          { className: "step-body" },
          el("div", { className: "step-title", text: t("camina_destino", { destino: destinoNombre }) })
        )
      )
    );
  }

  container.replaceChildren(band, el("div", { className: "page-inner" }, actions, el("div", { className: "card" }, ...pasos)));
}

export function renderEnRuta(container, ctx, cb) {
  const { viaje, paradaPorId, lineas, ubicacion } = ctx;
  const paradas = viaje.paradas;
  const lastIdx = paradas.length - 1;
  const faltan = Math.max(0, lastIdx - viaje.idxActual);
  const pBajar = paradaPorId[paradas[lastIdx]];
  const pActual = paradaPorId[paradas[Math.min(viaje.idxActual, lastIdx)]];
  const nombreBajar = pBajar?.nombre || `#${paradas[lastIdx]}`;
  const nombreActual = pActual?.nombre || `#${paradas[Math.min(viaje.idxActual, lastIdx)]}`;
  const alertando = faltan <= viaje.avisoParadas;
  const tieneSigTramo = viaje.tramoIdx + 1 < viaje.ruta.tramos.length;
  const sigTramo = tieneSigTramo ? viaje.ruta.tramos[viaje.tramoIdx + 1] : null;

  let titular;
  let sub;
  if (faltan === 0) {
    titular = t("has_llegado", { parada: nombreBajar });
    sub = t("llegado_sub");
  } else if (alertando) {
    titular = t("alerta_bajada", {
      cuanto: faltan === 1 ? t("proxima_parada") : t("faltan_n", { n: faltan }),
    });
    sub = `${t("alerta_sub")} · ${nombreBajar}`;
  } else {
    titular = faltan === 1 ? t("baja_en_1", { parada: nombreBajar }) : t("baja_en_n", { n: faltan, parada: nombreBajar });
    sub = t("pasando_por", { parada: nombreActual });
  }

  const band = el(
    "section",
    { className: `sub-band${alertando ? " is-alert" : ""}` },
    el(
      "div",
      { className: "sub-band-inner" },
      el(
        "div",
        { className: "band-top" },
        el(
          "span",
          { className: "band-kicker", style: { marginBottom: "0" } },
          badgeLinea(viaje.linea, lineas, { small: true }),
          el("span", { text: t("en_viaje_rumbo", { dest: viaje.destinoNombre }) })
        ),
        el("button", { type: "button", className: "band-btn", text: t("finalizar"), onClick: cb.onFinalizarViaje })
      ),
      el("h1", { className: "band-h1", text: titular }),
      el("p", { className: "band-sub", text: sub }),
      el(
        "div",
        { className: "band-footer" },
        el(
          "div",
          { className: "alert-toggle" },
          icono("bell", "ico ico-sm"),
          el("span", { text: t("avisar_antes") }),
          el(
            "div",
            { className: "alert-pills" },
            el("button", {
              type: "button",
              className: viaje.avisoParadas === 1 ? "is-active" : "",
              text: t("aviso_1"),
              onClick: () => cb.onCambiarAviso(1),
            }),
            el("button", {
              type: "button",
              className: viaje.avisoParadas === 2 ? "is-active" : "",
              text: t("aviso_2"),
              onClick: () => cb.onCambiarAviso(2),
            })
          )
        ),
        el(
          "button",
          { type: "button", className: "band-btn", onClick: cb.onVerViajeEnMapa },
          icono("map", "ico ico-sm"),
          el("span", { text: t("ver_en_mapa") })
        )
      )
    )
  );

  const distBajada =
    ubicacion && pBajar
      ? formatearDistancia(distanciaKm([ubicacion.lat, ubicacion.lon], [pBajar.lat, pBajar.lon]))
      : "";
  const gpsTexto =
    viaje.gpsEstado === "activo"
      ? [t("gps_activo"), distBajada].filter(Boolean).join(" · ")
      : viaje.gpsEstado === "error"
        ? t("gps_manual")
        : t("gps_esperando");

  // Only expose manual step button if GPS fails/is denied; otherwise GPS tracks stops automatically.
  const botonPaso =
    faltan === 0
      ? tieneSigTramo
        ? el("button", {
            type: "button",
            className: "btn-primary btn-sm",
            text: t("siguiente_tramo", { linea: etiquetaLinea(sigTramo.linea) }),
            onClick: cb.onSiguienteTramo,
          })
        : el("button", {
            type: "button",
            className: "btn-primary btn-sm",
            text: t("finalizar"),
            onClick: cb.onFinalizarViaje,
          })
      : viaje.gpsEstado === "error"
        ? el("button", {
            type: "button",
            className: "btn-secondary btn-sm",
            text: t("avanzar_parada"),
            onClick: cb.onAvanzarParada,
          })
        : null;

  const timeline = el(
    "div",
    { className: "card" },
    el(
      "div",
      { className: "tl-head" },
      el("span", { text: t("paradas_del_tramo", { linea: etiquetaLinea(viaje.linea) }) }),
      el("span", { className: "mono", text: `${Math.min(viaje.idxActual + 1, paradas.length)} / ${paradas.length}` })
    ),
    paradas.map((id, idx) => {
      const passed = idx < viaje.idxActual;
      const current = idx === viaje.idxActual && idx < lastIdx;
      const dropoff = idx === lastIdx;
      const cls = [
        "tl-stop",
        passed ? "is-passed" : "",
        current ? "is-current" : "",
        dropoff ? "is-dropoff" : "",
        dropoff && alertando ? "is-alert" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const etiqueta = dropoff
        ? faltan === 0
          ? t("baja_aqui")
          : t("tu_bajada")
        : current
          ? t("estas_aqui")
          : passed
            ? t("pasada")
            : "";
      return el(
        "div",
        { className: cls },
        el("span", { className: "tl-marker" }),
        el("span", { className: "tl-name", text: paradaPorId[id]?.nombre || `#${id}` }),
        etiqueta ? el("span", { className: "tl-badge", text: etiqueta }) : null
      );
    })
  );

  container.replaceChildren(
    band,
    el(
      "div",
      { className: "page-inner" },
      el(
        "div",
        { className: "trip-controls" },
        el(
          "span",
          { className: "gps-pill" },
          el("span", { className: `gps-dot${viaje.gpsEstado === "error" ? " is-warn" : ""}` }),
          el("span", { text: gpsTexto })
        ),
        botonPaso
      ),
      timeline
    )
  );
}

/* =========================================================================
   4. LINEAS & LINE DETAIL
   ========================================================================= */
export function renderLineas(container, ctx, cb) {
  const { lineas, ordenLineas, activas, tipoDia, filtroLineas, consultaLineas, red } = ctx;
  const total = ordenLineas.length;
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const q = norm(consultaLineas.trim());

  let codigos = ordenLineas.slice();
  if (filtroLineas === "hoy" && activas.size) codigos = codigos.filter((c) => activas.has(c));
  if (q) codigos = codigos.filter((c) => norm(c).includes(q) || norm(lineas[c]?.nombre).includes(q));

  container.replaceChildren(
    el(
      "div",
      { className: "page-inner" },
      el(
        "div",
        { className: "sec-block", style: { gap: "6px" } },
        el("h1", { className: "page-h1", text: t("lineas_titulo") }),
        el("p", {
          className: "sec-meta",
          text: t("lineas_sub", { activas: activas.size || total, dia: etiquetaDia(tipoDia), total }),
        })
      ),
      el(
        "div",
        { className: "map-search-box" },
        icono("search", "ico ico-sm"),
        el("input", {
          id: "inp-buscar-linea",
          type: "search",
          value: consultaLineas,
          placeholder: t("buscar_linea_ph"),
          onInput: (e) => cb.onBuscarLinea(e.target.value),
        })
      ),
      el(
        "div",
        { className: "seg-tabs" },
        [
          ["hoy", t("filtro_hoy")],
          ["todas", t("filtro_todas")],
        ].map(([id, label]) =>
          el("button", {
            type: "button",
            className: `seg-tab${filtroLineas === id ? " is-active" : ""}`,
            text: label,
            onClick: () => cb.onFiltroLineas(id),
          })
        )
      ),
      el(
        "div",
        { className: "card" },
        codigos.length
          ? codigos.map((cod) => {
              const activa = !activas.size || activas.has(cod);
              return el(
                "button",
                { type: "button", className: "line-row", onClick: () => cb.onAbrirLinea(cod) },
                badgeLinea(cod, lineas),
                el(
                  "div",
                  { className: "line-info" },
                  el("div", { className: "line-name", text: lineas[cod]?.nombre || cod }),
                  el("div", { className: "line-sub", text: t("paradas_n", { n: new Set(red[cod] || []).size }) })
                ),
                el("span", {
                  className: activa ? "pill-live" : "pill-neutral",
                  text: activa ? t("en_servicio_hoy") : t("sin_servicio_hoy"),
                })
              );
            })
          : el("div", { className: "empty-card", style: { border: "none" }, text: t("sin_paradas_filtro") })
      )
    )
  );
}

export function renderDetalleLinea(container, ctx, cb) {
  const { codigo, lineas, red, paradaPorId, activas } = ctx;
  const info = lineas[codigo] || {};
  const seq = red[codigo] || [];
  const activa = !activas.size || activas.has(codigo);

  const band = el(
    "section",
    { className: "sub-band" },
    el(
      "div",
      { className: "sub-band-inner" },
      el(
        "div",
        { className: "band-top" },
        el(
          "button",
          { type: "button", className: "band-back", onClick: cb.onVolver },
          icono("back", "ico ico-sm"),
          el("span", { text: t("volver") })
        ),
        el(
          "button",
          { type: "button", className: "band-btn", onClick: () => cb.onVerLineaEnMapa(codigo) },
          icono("map", "ico ico-sm"),
          el("span", { text: t("ver_en_mapa") })
        )
      ),
      el(
        "div",
        { className: "band-kicker" },
        badgeLinea(codigo, lineas, { small: true }),
        el("span", { text: activa ? t("en_servicio_hoy") : t("sin_servicio_hoy") })
      ),
      el("h1", { className: "band-h1", text: info.nombre || codigo }),
      el("p", { className: "band-sub", text: t("recorrido_paradas", { n: new Set(seq).size }) })
    )
  );

  const card = el(
    "div",
    { className: "card" },
    seq.map((id, idx) => {
      const p = paradaPorId[id];
      return el(
        "button",
        {
          type: "button",
          className: "list-stop-row",
          onClick: () => cb.onAbrirParadaEnMapa(p || { id }),
        },
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "10px", minWidth: "0" } },
          el("span", { className: "mono", style: { fontSize: "12px", color: "var(--on-surface-variant)", width: "26px" }, text: `${idx + 1}.` }),
          el(
            "div",
            { style: { minWidth: "0" } },
            el("div", { className: "line-name", text: p?.nombre || `#${id}` }),
            el("div", { className: "line-sub", text: t("parada_num", { id }) })
          )
        )
      );
    })
  );

  container.replaceChildren(band, el("div", { className: "page-inner" }, card));
}

/* =========================================================================
   5. PARADAS (FAVORITAS · CERCANAS · TODAS) & STOP DETAIL
   ========================================================================= */
export function renderParadas(container, ctx, cb) {
  const { paradas, favoritasSet, filtroParadas, consultaParadas, ubicacion, tiemposCache, lineas } = ctx;

  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const q = norm(consultaParadas.trim());

  let lista = paradas.slice();
  if (filtroParadas === "favoritas") {
    lista = lista.filter((p) => favoritasSet.has(p.id));
  }
  if (q) {
    lista = lista.filter((p) => norm(p.nombre).includes(q) || String(p.id).includes(q));
  }
  if (filtroParadas === "cercanas" && ubicacion) {
    lista.sort(
      (a, b) =>
        distanciaKm([ubicacion.lat, ubicacion.lon], [a.lat, a.lon]) -
        distanciaKm([ubicacion.lat, ubicacion.lon], [b.lat, b.lon])
    );
  }
  const visibles = lista.slice(0, 80);

  container.replaceChildren(
    el(
      "div",
      { className: "page-inner" },
      el(
        "div",
        { className: "sec-block", style: { gap: "6px" } },
        el("h1", { className: "page-h1", text: t("paradas_titulo") }),
        el("p", { className: "sec-meta", text: t("paradas_sub", { n: paradas.length }) })
      ),
      el(
        "div",
        { className: "map-search-box" },
        icono("search", "ico ico-sm"),
        el("input", {
          id: "inp-buscar-parada",
          type: "search",
          value: consultaParadas,
          placeholder: t("buscar_parada_ph"),
          onInput: (e) => cb.onBuscarParada(e.target.value),
        })
      ),
      el(
        "div",
        { className: "seg-tabs" },
        [
          ["favoritas", t("filtro_favoritas")],
          ["cercanas", t("filtro_cercanas")],
          ["todas", t("filtro_todas")],
        ].map(([id, label]) =>
          el("button", {
            type: "button",
            className: `seg-tab${filtroParadas === id ? " is-active" : ""}`,
            text: label,
            onClick: () => cb.onFiltroParadas(id),
          })
        )
      ),
      visibles.length
        ? el(
            "div",
            { className: "nearby-list" },
            visibles.map((p) => {
              const esFav = favoritasSet.has(p.id);
              const prim = primeraLlegadaParada(p.id, tiemposCache, lineas);
              const dist = ubicacion
                ? formatearDistancia(distanciaKm([ubicacion.lat, ubicacion.lon], [p.lat, p.lon]))
                : "";
              const lins = (p.lineas || []).slice(0, 4).map(etiquetaLinea).join(", ");
              const sub = [t("parada_num", { id: p.id }), dist, lins].filter(Boolean).join(" · ");
              return el(
                "div",
                { className: "nearby-row" },
                el(
                  "button",
                  { type: "button", className: "nearby-main", onClick: () => cb.onAbrirParada(p.id) },
                  el("span", { style: { color: "var(--on-primary-container)", display: "inline-flex" } }, icono("hail", "ico")),
                  el(
                    "div",
                    { style: { minWidth: "0" } },
                    el("div", { className: "nearby-title", text: p.nombre }),
                    el("div", { className: "nearby-sub", text: sub })
                  )
                ),
                el(
                  "div",
                  { className: "nearby-right" },
                  prim ? el("span", { className: "nearby-min", text: textoMinutos(prim.min, prim.raw) }) : null,
                  el(
                    "button",
                    {
                      type: "button",
                      className: `icon-round-btn${esFav ? " is-star" : ""}`,
                      "aria-label": esFav ? t("quitar_favorita") : t("guardar_favorita"),
                      onClick: () => cb.onAlternarFavorita(p.id),
                    },
                    icono("star", "ico", esFav)
                  )
                )
              );
            })
          )
        : el("div", {
            className: "empty-card",
            text: filtroParadas === "favoritas" ? t("favoritas_vacio") : t("sin_paradas_filtro"),
          })
    )
  );
}

export function renderDetalleParada(container, ctx, cb) {
  const { parada, esFav, llegadas, cargando, error, ubicacion, lineas } = ctx;
  const items = normalizarLlegadas(llegadas, lineas);
  const dist = ubicacion ? formatearDistancia(distanciaKm([ubicacion.lat, ubicacion.lon], [parada.lat, parada.lon])) : "";
  const sub = [t("parada_num", { id: parada.id }), dist].filter(Boolean).join(" · ");

  const band = el(
    "section",
    { className: "sub-band" },
    el(
      "div",
      { className: "sub-band-inner" },
      el(
        "div",
        { className: "band-top" },
        el(
          "button",
          { type: "button", className: "band-back", onClick: cb.onVolver },
          icono("back", "ico ico-sm"),
          el("span", { text: t("volver") })
        ),
        el(
          "div",
          { style: { display: "flex", gap: "8px" } },
          el(
            "button",
            {
              type: "button",
              className: "band-btn",
              onClick: () => cb.onAlternarFavorita(parada.id),
            },
            icono("star", "ico ico-sm", esFav),
            el("span", { text: esFav ? t("quitar_favorita") : t("guardar_favorita") })
          ),
          el(
            "button",
            { type: "button", className: "band-btn", onClick: () => cb.onVerParadaEnMapa(parada) },
            icono("map", "ico ico-sm"),
            el("span", { text: t("ver_en_mapa") })
          )
        )
      ),
      el("h1", { className: "band-h1", text: parada.nombre }),
      el("p", { className: "band-sub", text: sub })
    )
  );

  let listaLlegadas;
  if (cargando && !llegadas) {
    listaLlegadas = el("div", { className: "sec-meta", text: t("actualizando") });
  } else if (error) {
    listaLlegadas = el(
      "div",
      { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" } },
      el("span", { className: "sec-meta", text: t("error_tiempos") }),
      el("button", { type: "button", className: "btn-secondary btn-sm", text: t("reintentar"), onClick: () => cb.onRecargar(parada.id) })
    );
  } else if (!items.length) {
    listaLlegadas = el("div", { className: "sec-meta", text: t("sin_buses") });
  } else {
    listaLlegadas = el(
      "ul",
      { className: "arr-list" },
      items.map((it) =>
        el(
          "li",
          { className: "arr-item" },
          el(
            "div",
            { className: "arr-left" },
            el(
              "button",
              { type: "button", onClick: () => cb.onAbrirLinea(it.cod), title: it.nombre },
              badgeLinea(it.cod, lineas, { small: true })
            ),
            el(
              "div",
              { style: { minWidth: "0" } },
              el("div", { className: "arr-dest", text: it.nombre }),
              it.metros !== null ? el("div", { className: "arr-dist", text: formatearMetros(it.metros) }) : null
            )
          ),
          it.min === 0
            ? el("span", { className: "pill-live mono", text: t("ahora") })
            : el("span", {
                className: `arr-time${it.min !== null && it.min <= 6 ? " is-soon" : ""}`,
                text: textoMinutos(it.min, it.raw),
              })
        )
      )
    );
  }

  const cardLlegadas = el(
    "article",
    { className: "sheet-card" },
    el(
      "div",
      { className: "sec-head" },
      el("h2", { className: "sec-title", text: t("en_directo") }),
      el("button", { type: "button", className: "sec-link", text: t("actualizar"), onClick: () => cb.onRecargar(parada.id) })
    ),
    listaLlegadas,
    el(
      "footer",
      { className: "sheet-foot" },
      el("button", { type: "button", className: "sec-link", text: t("salir_desde_aqui"), onClick: () => cb.onSalirDesde(parada) }),
      el(
        "button",
        { type: "button", className: "btn-primary btn-sm", onClick: () => cb.onComoLlegar(parada) },
        icono("walk", "ico ico-sm"),
        el("span", { text: t("como_llegar") })
      )
    )
  );

  const cardLineas = el(
    "section",
    { className: "sec-block" },
    el("h2", { className: "sec-title", text: t("lineas_en_parada") }),
    el(
      "div",
      { className: "card" },
      el(
        "div",
        { className: "chips-wrap" },
        (parada.lineas || []).map((cod) =>
          el("button", { type: "button", onClick: () => cb.onAbrirLinea(cod) }, badgeLinea(cod, lineas))
        )
      )
    )
  );

  container.replaceChildren(band, el("div", { className: "page-inner" }, cardLlegadas, cardLineas));
}

/* =========================================================================
   6. PERSISTENT LIVE TRIP BANNER
   ========================================================================= */
export function renderTripBanner(elBanner, viaje, paradaPorId, onVolverViaje) {
  if (!viaje) {
    elBanner.hidden = true;
    return;
  }
  const lastIdx = viaje.paradas.length - 1;
  const faltan = Math.max(0, lastIdx - viaje.idxActual);
  const alertando = faltan <= viaje.avisoParadas;
  const pBajar = paradaPorId[viaje.paradas[lastIdx]];
  const nombreBajar = pBajar?.nombre || `#${viaje.paradas[lastIdx]}`;
  const lineaLbl = etiquetaLinea(viaje.linea);
  const texto = alertando
    ? t("banner_alerta", { linea: lineaLbl, parada: nombreBajar })
    : t("banner_en_viaje", {
        linea: lineaLbl,
        parada: nombreBajar,
        cuanto: faltan === 0 ? t("banner_baja_ahora") : t("banner_baja_en", { n: faltan }),
      });

  elBanner.hidden = false;
  elBanner.className = `trip-banner${alertando ? " is-alert" : ""}`;
  elBanner.replaceChildren(
    el(
      "div",
      { className: "trip-banner-inner" },
      el(
        "div",
        { className: "trip-banner-left" },
        el("span", { className: "trip-banner-dot" }),
        el("span", { className: "trip-banner-text", text: texto })
      ),
      el("button", { type: "button", className: "trip-banner-btn", text: t("volver_viaje"), onClick: onVolverViaje })
    )
  );
}
