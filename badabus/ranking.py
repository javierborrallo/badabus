import json
import math
import re
from collections import Counter
from pathlib import Path
from typing import NamedTuple

from badabus import frecuencias as frec
from badabus.planner import tramo_en_secuencia

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

VELOCIDAD_CRUCERO_KMH = 35     # cruising speed between stops
TIEMPO_POR_PARADA_MIN = 0.7    # dwell and accel/decel minutes per stop
FACTOR_SINUOSIDAD = 1.3        # the real course winds ~30% more than the line
FACTOR_DESCARTE = 1.5         # anything over 1.5x the best one is dropped
LIMITE_RUTAS = 4               # most alternatives returned

VELOCIDAD_ANDANDO_KMH = 4.5      # a normal pace
FACTOR_CALLEJEO = 1.3            # on foot you do not go straight either
PESO_ANDANDO = 1.3               # walking weight in `comparable` (shown total stays un-weighted)
PENALIZACION_TRANSBORDO_MIN = 5  # transfer penalty in `comparable` (shown total stays untouched)
RADIO_PARADAS_KM = 1.0           # sanity limit when looking for nearby stops
RADIO_TRANSBORDO_KM = 0.3      # how far you walk between stops to transfer
MARGEN_LLEGADA_MIN = 2         # margin to call a bus caught (walking is an estimate)
ESPERA_TRANSBORDO_MIN = 5      # assumed at a transfer with no known frequency
# The assumed wait for a bus with no live data and no published frequency. It is half
# of the median published frequency (30 min), which is the expected wait if you reach
# the stop at a random time. It is not a measurement. It is the least bad alternative
# to counting zero, which is the only value that is certainly wrong.
ESPERA_SIN_DATO_MIN = 15

RADIO_TIERRA_KM = 6371.0


def distancia_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Straight-line distance (haversine) between two (lat, lon) points, in kilometres."""
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = (math.sin(dlat / 2) ** 2 +
         math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2)
    return 2 * RADIO_TIERRA_KM * math.asin(math.sqrt(h))


def cargar_shapes(data_dir: Path = DATA_DIR) -> dict:
    """The geometry of each line, or {} if the file is not there."""
    try:
        return json.loads((data_dir / "shapes.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _puntos(sentido: list) -> list:
    salida = []
    for p in sentido:
        if isinstance(p, dict):
            lat, lon = p.get("lat"), p.get("lon")
        elif isinstance(p, (list, tuple)) and len(p) >= 2:
            lat, lon = p[0], p[1]
        else:
            continue
        try:
            salida.append((float(lat), float(lon)))
        except (TypeError, ValueError):
            continue
    return salida


def _pasos_en_trazado(coord: tuple[float, float], pts: list, radio_km: float = 0.08) -> list[int]:
    """Local nearest indices along `pts` within `radio_km`, falling back to global nearest."""
    hits: list[int] = []
    mejor: tuple[float, int] | None = None
    for k, q in enumerate(pts):
        d = distancia_km(coord, q)
        if d < radio_km:
            if mejor is None or d < mejor[0]:
                mejor = (d, k)
        elif mejor is not None:
            hits.append(mejor[1])
            mejor = None
    if mejor is not None:
        hits.append(mejor[1])
    if not hits:
        hits = [min(range(len(pts)), key=lambda i: distancia_km(coord, pts[i]))]
    return hits


def distancias_por_tramo(red: dict, paradas: dict, shapes: dict) -> dict:
    """Road distance between consecutive stops: {(line, a, b): km}."""
    reales: dict[tuple, float] = {}
    for linea, seq in red.items():
        for sentido in (shapes.get(linea) or {}).values():
            pts = _puntos(sentido)
            if len(pts) < 2:
                continue
            pasos = {p: _pasos_en_trazado(paradas[p], pts) for p in set(seq) if p in paradas}
            acum = [0.0]
            for k in range(len(pts) - 1):
                acum.append(acum[-1] + distancia_km(pts[k], pts[k + 1]))
            for a, b in zip(seq, seq[1:], strict=False):
                if a not in pasos or b not in pasos:
                    continue
                recta = distancia_km(paradas[a], paradas[b])
                if recta <= 0:
                    continue
                mejor_km: float | None = None
                for ia in pasos[a]:
                    for ib in pasos[b]:
                        if ib <= ia:
                            continue
                        km = acum[ib] - acum[ia]
                        if recta <= km <= recta * 3 and (mejor_km is None or km < mejor_km):
                            mejor_km = km
                if mejor_km is not None:
                    prev = reales.get((linea, a, b))
                    if prev is None or mejor_km < prev:
                        reales[(linea, a, b)] = mejor_km
    return reales


def _km_y_paradas_entre_indices(
    linea: str, i: int, j: int, red: dict, paradas: dict, reales: dict
) -> tuple[float, int]:
    """Road distance and stop count of the line between positions `i` and `j`."""
    entre = [s for s in red[linea][i:j + 1] if s in paradas]
    if len(entre) < 2:
        return 0.0, 0
    km = 0.0
    for a, b in zip(entre, entre[1:], strict=False):
        medida = reales.get((linea, a, b))
        km += medida if medida is not None else distancia_km(paradas[a], paradas[b]) * FACTOR_SINUOSIDAD
    return km, len(entre) - 1


def _minutos_entre_indices(
    linea: str, i: int, j: int, red: dict, paradas: dict, reales: dict
) -> float:
    km, n_paradas = _km_y_paradas_entre_indices(linea, i, j, red, paradas, reales)
    if n_paradas <= 0:
        return 0.0
    return km / VELOCIDAD_CRUCERO_KMH * 60 + n_paradas * TIEMPO_POR_PARADA_MIN


def _km_tramo(
    linea: str, subir: str, bajar: str, red: dict, paradas: dict, reales: dict
) -> float:
    indices = tramo_en_secuencia(red[linea], subir, bajar)
    if indices is None:
        raise ValueError(f"line {linea} does not go from {subir} to {bajar}")
    km, _ = _km_y_paradas_entre_indices(linea, *indices, red, paradas, reales)
    return km


def _minutos_tramo(
    linea: str, subir: str, bajar: str, red: dict, paradas: dict, reales: dict
) -> float:
    indices = tramo_en_secuencia(red[linea], subir, bajar)
    if indices is None:
        raise ValueError(f"line {linea} does not go from {subir} to {bajar}")
    return _minutos_entre_indices(linea, *indices, red, paradas, reales)


def minutos_viaje(
    ruta: list[dict], red: dict, paradas: dict, reales: dict | None = None
) -> float:
    """Estimated ride time in minutes using cruising speed plus per-stop dwell time."""
    reales = reales or {}
    return sum(
        _minutos_tramo(tramo["linea"], tramo["subir"], tramo["bajar"], red, paradas, reales)
        for tramo in ruta
    )


def minutos_andando(km: float) -> float:
    """Walking minutes for a straight-line distance, corrected because a person does
    not walk through buildings.
    """
    return km * FACTOR_CALLEJEO / VELOCIDAD_ANDANDO_KMH * 60


def km_entre_tramos(ruta: list, paradas: dict) -> float:
    """The distance walked at a transfer, when you do not board where you alighted.

    With transfers between nearby stops, a trip is no longer only bus. There are metres
    on foot in the middle. If they are not counted, they look free, and they are not.
    """
    total = 0.0
    for anterior, siguiente in zip(ruta, ruta[1:], strict=False):
        if anterior["bajar"] == siguiente["subir"]:
            continue
        a, b = paradas.get(anterior["bajar"]), paradas.get(siguiente["subir"])
        if a and b:
            total += distancia_km(a, b)
    return total


def vecindad(paradas: dict, radio_km: float = RADIO_TRANSBORDO_KM) -> dict[str, list]:
    """Which stops are within walking distance of each other: {stop: [(other, km)]}.

    This is the opposite of `paradas_cercanas`, which measures from a single arbitrary
    point and scans all the stops on every call. Here the whole network is needed at once, so
    that a transfer does not require both lines to call at the same place.
    """
    ids = list(paradas)
    vecinas: dict[str, list] = {p: [] for p in ids}
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            km = distancia_km(paradas[a], paradas[b])
            if km <= radio_km:
                vecinas[a].append((b, km))
                vecinas[b].append((a, km))
    return vecinas


def paradas_cercanas(
    lat: float, lon: float, paradas: dict
) -> list[tuple[str, float]]:
    """The stops within RADIO_PARADAS_KM of a point, as [(id, km)], nearest first.

    The list is not trimmed. Keeping only the nearest stops hides whole lines, because
    stops close together tend to serve the same lines. The planner does not pay to look
    at all of them, and the ranking decides whether the walk is worth it.
    """
    cerca = []
    for parada, coords in paradas.items():
        km = distancia_km((lat, lon), coords)
        if km <= RADIO_PARADAS_KM:
            cerca.append((parada, km))
    cerca.sort(key=lambda p: p[1])
    return cerca


_ALIAS_LINEA = {"BGM1": "BG1", "BGM2": "BG2"}
_PREFIJO_LINEA = re.compile(r"^L[ÍI]NEA\s+", re.IGNORECASE)


def codigo_linea(texto: str) -> str:
    """Line name from the arrivals feed to a line code: it removes the 'LÍNEA ' prefix,
    in any case, and applies the BGM1 and BGM2 aliases.
    """
    codigo = _PREFIJO_LINEA.sub("", str(texto)).strip()
    return _ALIAS_LINEA.get(codigo, codigo)


def minutos_espera(texto: str) -> float:
    """Minutes to the next bus: '4 Minutos.' -> 4, 'Próximo.' -> 0, no number -> inf.
    """
    encontrado = re.search(r"\d+", str(texto))
    if encontrado:
        return float(encontrado.group())
    if re.search(r"pr[óo]ximo", str(texto), re.IGNORECASE):
        return 0.0
    return math.inf


def esperas_por_linea(tiempos: list[dict]) -> dict[str, float]:
    """From the arrivals response of one stop: {line code: shortest wait in minutes}.
    """
    esperas: dict[str, float] = {}
    for fila in tiempos:
        codigo = codigo_linea(fila.get("linea", ""))
        espera = minutos_espera(fila.get("tiempo", ""))
        if codigo not in esperas or espera < esperas[codigo]:
            esperas[codigo] = espera
    return esperas


class Puntuada(NamedTuple):
    """A route that is already measured, with **two** totals that are not the same number.

    `total` is what the user sees. With an unknown wait it is a floor, and the card says
    so ("from X min"): the application does not assert what it does not know.

    `comparable` decides the order, which route dominates which, and what is dropped for
    being much worse. A floor is wrong there: counting zero for an unknown wait makes
    the least known route win every time, so unknown waits use half the frequency where
    published and a fixed figure otherwise. Walking is also weighted by `PESO_ANDANDO`
    so catching the same bus at a farther stop never ties or beats the nearer one.
    """

    total: float
    comparable: float
    viaje: float
    espera: float | None
    tope: float | None
    andando: float
    transbordo: float
    aviso: str | None
    ruta: list


def _espera_estimada(espera: float | None, tope: float | None) -> float:
    """The wait that can be expected, for comparison. Never zero just because it is unknown."""
    if espera is not None:
        return espera
    return tope / 2 if tope else ESPERA_SIN_DATO_MIN


def _orden(p: Puntuada) -> tuple:
    """By generalized cost, then fewer legs, then less walking.

    The tie-break is not cosmetic. Without it, "take a line and then another bus" can
    slip ahead of that same line on its own, and the rule that drops detours never sees
    it.
    """
    return (p.comparable, len(p.ruta), p.andando)


def _circula(p: Puntuada) -> bool:
    return p.aviso != "fuera_de_servicio"


def _fusionar_por_paradas(puntuadas: list) -> list:
    """Merges the routes that board and alight at the same stops and only change line.

    They are not different alternatives. They are the same trip with several buses that
    serve it, and that is worth knowing, because you take the first one that comes. Only
    routes that differ in a single leg are merged. If two legs differ, there is no
    evidence that the combination exists.
    """
    grupos: dict[tuple, list] = {}
    for p in puntuadas:
        # A line that does not run is not interchangeable with one that does: to
        # present them together ("take the first one that comes") would be a lie. They
        # are grouped separately.
        clave = (tuple((t["subir"], t["bajar"]) for t in p.ruta),
                 p.aviso == "fuera_de_servicio")
        grupos.setdefault(clave, []).append(p)

    salida = []
    for miembros in grupos.values():
        base = miembros[0]
        lineas_base = [t["linea"] for t in base.ruta]
        otras: dict[int, set] = {}
        for otro in miembros[1:]:
            lineas = [t["linea"] for t in otro.ruta]
            distintas = [i for i, (a, b) in enumerate(zip(lineas_base, lineas, strict=True)) if a != b]
            if len(distintas) == 1:
                otras.setdefault(distintas[0], set()).add(lineas[distintas[0]])
            else:
                salida.append(otro)
        if otras:
            tramos = [dict(t) for t in base.ruta]
            for i, lineas in otras.items():
                tramos[i]["alternativas"] = sorted(lineas)
            base = base._replace(ruta=tramos)
        salida.append(base)
    salida.sort(key=_orden)
    return salida


def _sin_dominadas(puntuadas: list) -> list:
    """Removes transfer routes equalled or beaten on generalized cost, walking and transfers.

    Direct routes are kept as-is and filtered later by `FACTOR_DESCARTE` and
    `LIMITE_RUTAS`. Unknown waits never discard known ones.
    """
    aceptadas: list[Puntuada] = []
    for p in puntuadas:
        total, andando, saltos = p.comparable, p.andando, len(p.ruta)
        if saltos > 1 and any(
            q.comparable <= total and q.andando <= andando and len(q.ruta) <= saltos
            and not (q.espera is None and p.espera is not None)
            for q in aceptadas
        ):
            continue
        aceptadas.append(p)
    return aceptadas


def _sin_rodeos(puntuadas: list) -> list:
    """Removes the routes that are a shorter route with extra buses added on.

    If one line alone takes you there, "that line and then another bus" is not an
    alternative: you reach the same place later. The routes arrive ordered by time, so
    any route that starts with an already accepted one is worse by definition.
    """
    aceptadas: list[Puntuada] = []
    lineas_ok: list[tuple] = []
    for p in puntuadas:
        lineas = tuple(t["linea"] for t in p.ruta)
        if any(lineas[:len(corta)] == corta for corta in lineas_ok):
            continue
        aceptadas.append(p)
        lineas_ok.append(lineas)
    return aceptadas


def _una_por_combinacion(puntuadas: list) -> list:
    """One route per combination of lines: the fastest one.

    The same combination boarded at another stop is the same trip with more walking, not
    an alternative. The routes arrive ordered by time, so the first one is the one to
    keep.
    """
    vistas: dict[tuple, Puntuada] = {}
    for p in puntuadas:
        # By the SET of lines of each leg: after alternatives are merged, "A or B"
        # and "B or A" are the same trip, even if the one listed first changes.
        clave = tuple(
            frozenset([t["linea"], *t.get("alternativas", [])]) for t in p.ruta
        )
        vistas.setdefault(clave, p)
    return list(vistas.values())


def _espera_en_transbordos(
    ruta: list, red: dict, paradas: dict, esperas: dict, horarios: dict,
    tipo_dia: str | None, ahora_min: int | None, desde_min: float,
    reales: dict | None = None,
    viaje_tramo=None, pasadas_fn=None, intervalo_fn=None,
) -> float:
    """The wait at each transfer, read from live data instead of assumed.

    The service gives arrivals for **any** stop, not only the origin one, so at the
    transfer the arrival of the other line is known too. With that and the estimated
    arrival time, the real wait is calculated instead of assumed.

    If that bus is missed — the arrival is an estimate, so it requires the same margin
    as the departure — the next one is taken by adding the frequency. Without live data,
    half the frequency applies, which is the expected wait at a random point of the
    timetable. Without a frequency, a fixed figure applies: a transfer is never free.
    """
    total = 0.0
    reloj = desde_min          # minutes from now when the current leg starts
    for anterior, tramo in zip(ruta, ruta[1:], strict=False):
        if viaje_tramo is not None:
            reloj += viaje_tramo(anterior)
        else:
            reloj += minutos_viaje([anterior], red, paradas, reales)
        if anterior["bajar"] != tramo["subir"]:
            # The transfer is on foot: you must arrive before you can board.
            reloj += minutos_andando(km_entre_tramos([anterior, tramo], paradas))
        linea = tramo["linea"]
        intervalo = None
        if intervalo_fn is not None:
            intervalo = intervalo_fn(linea)
        elif horarios and tipo_dia and ahora_min is not None:
            intervalo = frec.intervalo_min(horarios, linea, tipo_dia, ahora_min)
        # The same as at the start: it looks at when each bus calls at this stop, not
        # only the announced one, and takes the first one that can be reached in time.
        if pasadas_fn is not None:
            pasos = pasadas_fn(linea, tramo["subir"], _indice_subida(tramo, red))
        else:
            pasos = pasadas_en_parada(
                linea, tramo["subir"], esperas, red, paradas, reales, intervalo,
                indice=_indice_subida(tramo, red))
        alcanzables = [t for t in pasos if t >= reloj + MARGEN_LLEGADA_MIN]
        if alcanzables:
            espera = min(alcanzables) - reloj
        else:
            espera = intervalo / 2 if intervalo else ESPERA_TRANSBORDO_MIN
        total += espera
        reloj += espera
    return total


def _indice_subida(tramo: dict, red: dict) -> int | None:
    """Position in the line sequence where the leg boards."""
    indices = tramo_en_secuencia(red.get(tramo["linea"]) or [], tramo["subir"], tramo["bajar"])
    return indices[0] if indices else None


def paradas_ambiguas(seq: list[str]) -> set[str]:
    """Stops served more than once before the loop-closing return terminal."""
    sin_cierre = seq[:-1] if len(seq) >= 2 and seq[0] == seq[-1] else seq
    return {p for p, n in Counter(sin_cierre).items() if n > 1}


def pasadas_en_parada(
    linea: str, parada: str, esperas: dict, red: dict, paradas: dict,
    reales: dict | None = None, intervalo: float | None = None,
    indice: int | None = None,
) -> list[float]:
    """Minutes from now at which each bus of that line calls at `parada`.

    `indice` selects the pass when `parada` repeats mid-route; without it, an ambiguous
    stop returns an empty list. Loop-closing terminals (`seq[0] == seq[-1]`) are
    unambiguous at index 0. Observations at mid-route repeated stops are ignored.
    """
    seq = red.get(linea) or []
    if parada not in seq:
        return []
    ambiguas = paradas_ambiguas(seq)
    if indice is None and parada in ambiguas:
        return []
    aqui = seq.index(parada) if indice is None else indice
    reales = reales or {}
    vistas = []
    for otra, lineas in esperas.items():
        observada = lineas.get(linea)
        if observada is None or observada == math.inf or otra not in seq or otra in ambiguas:
            continue
        alli = seq.index(otra)
        if alli == aqui:
            vistas.append(float(observada))
        elif alli < aqui:
            vistas.append(observada + _minutos_entre_indices(linea, alli, aqui, red, paradas, reales))
        else:
            vistas.append(observada - _minutos_entre_indices(linea, aqui, alli, red, paradas, reales))
    if not vistas:
        return []
    salida = set()
    for t in vistas:
        salida.add(round(t, 2))
        if intervalo:
            for n in range(1, 4):
                salida.add(round(t + intervalo * n, 2))
    return sorted(salida)


def _resolver_espera(
    linea: str, pasadas: list, hasta_la_parada: float, camina: bool,
    horarios: dict, tipo_dia: str | None, ahora_min: int | None,
    intervalo_fn=None, en_servicio_fn=None,
) -> tuple:
    """How long the wait for the bus is, and what can be asserted about it.

    Returns (espera, tope, aviso). `espera` is minutes when a number can be supported.
    `tope` is the most it can take when the wait is unknown but the frequency is not.
    `aviso` explains why there is no closed number.

    It receives **when each bus calls** at this stop, not only the next one, so the choice
    is to keep the first bus that can be reached in time. If one goes past before you can
    be there, the notice says so: you take the following one, not the announced one.
    """
    intervalo = None
    if horarios and tipo_dia and ahora_min is not None:
        activo = (
            en_servicio_fn(linea, ahora_min)
            if en_servicio_fn is not None
            else frec.en_servicio(horarios, linea, tipo_dia, ahora_min)
        )
        if activo is False:
            return None, None, "fuera_de_servicio"
        intervalo = (
            intervalo_fn(linea)
            if intervalo_fn is not None
            else frec.intervalo_min(horarios, linea, tipo_dia, ahora_min)
        )

    if not pasadas:
        # Without live data the last bus is unknown, but the frequency bounds the
        # wait: never more than one full interval.
        return None, intervalo, "sin_datos"

    # The walking estimate is approximate, so the timing must not be cut so fine.
    listo = hasta_la_parada + (MARGEN_LLEGADA_MIN if camina else 0)
    alcanzables = [t for t in pasadas if t >= listo]
    if not alcanzables:
        return None, intervalo, "no_llegas"

    primera = min(alcanzables)
    if ahora_min is not None and horarios:
        minuto_subida = int(ahora_min + primera)
        activo_subida = (
            en_servicio_fn(linea, minuto_subida)
            if en_servicio_fn is not None
            else frec.en_servicio(horarios, linea, tipo_dia, minuto_subida)
        )
        if activo_subida is False:
            return None, None, "fuera_de_servicio"
    # If one goes past before you can be ready, that bus is missed, and it is worth saying so.
    perdido = any(0 <= t < listo for t in pasadas)
    return primera - hasta_la_parada, None, ("no_llegas" if perdido else None)


def puntuar(
    rutas: list[list[dict]],
    red: dict,
    paradas: dict,
    esperas: dict,
    andando_origen: dict | None = None,
    andando_destino: dict | None = None,
    horarios: dict | None = None,
    tipo_dia: str | None = None,
    ahora_min: int | None = None,
    reales: dict | None = None,
) -> list[dict]:
    """Orders routes by generalized cost (`comparable`) and drops much worse ones.

    The total is walk + wait + ride, with the transfer waits inside. `esperas` is keyed
    ({stop_id: {line: minutes}}), because each candidate origin has its own.
    `andando_origen` and `andando_destino` are {stop_id: km}. They are empty when the
    user picks the stops by hand and there is no walk to count.

    Each route is returned as {"tramos", "total_min", "viaje_min", "espera_min",
    "espera_max_min", "espera_transbordo_min", "andando_min", "aviso_espera"}.
    `total_min` is the sum and the single source of truth: the frontend
    draws it and does not recalculate it. Minutes are rounded, and None marks a value
    that is not known. Without coordinates nothing can be estimated, and the routes come
    back in planner order.
    """
    andando_origen = andando_origen or {}
    andando_destino = andando_destino or {}
    hay_caminata = bool(andando_origen or andando_destino)

    if not paradas:
        return [
            {"tramos": ruta, "total_min": None, "viaje_min": None,
             "espera_min": None, "espera_max_min": None,
             "espera_transbordo_min": None,
             "andando_min": None, "aviso_espera": None}
            for ruta in rutas[:LIMITE_RUTAS]
        ]

    # Memoize per-call lookups repeated across thousands of candidate routes.
    reales_map = reales or {}
    horarios_map = horarios or {}
    memoria: dict[tuple, list] = {}
    memo_km_tramo: dict[tuple, float] = {}
    memo_intervalo: dict[str, float | None] = {}
    memo_servicio: dict[tuple, bool | None] = {}

    def intervalo_linea(linea: str) -> float | None:
        if not (horarios_map and tipo_dia and ahora_min is not None):
            return None
        if linea not in memo_intervalo:
            memo_intervalo[linea] = frec.intervalo_min(horarios_map, linea, tipo_dia, ahora_min)
        return memo_intervalo[linea]

    def servicio_linea(linea: str, minuto: int) -> bool | None:
        if not (horarios_map and tipo_dia):
            return None
        clave = (linea, minuto)
        if clave not in memo_servicio:
            memo_servicio[clave] = frec.en_servicio(horarios_map, linea, tipo_dia, minuto)
        return memo_servicio[clave]

    def viaje_tramo(tramo: dict) -> float:
        clave = (tramo["linea"], tramo["subir"], tramo["bajar"])
        if clave not in memo_km_tramo:
            memo_km_tramo[clave] = _minutos_tramo(
                tramo["linea"], tramo["subir"], tramo["bajar"], red, paradas, reales_map
            )
        return memo_km_tramo[clave]

    def pasadas(linea: str, parada: str, indice: int | None) -> list:
        clave = (linea, parada, indice)
        if clave not in memoria:
            memoria[clave] = pasadas_en_parada(
                linea, parada, esperas, red, paradas, reales_map, intervalo_linea(linea),
                indice=indice,
            )
        return memoria[clave]

    puntuadas = []
    for ruta in rutas:
        subir = ruta[0]["subir"]
        bajar = ruta[-1]["bajar"]
        viaje = sum(viaje_tramo(t) for t in ruta)
        km = (andando_origen.get(subir, 0.0) + andando_destino.get(bajar, 0.0)
              + km_entre_tramos(ruta, paradas))
        andando = minutos_andando(km)
        hasta_la_parada = minutos_andando(andando_origen.get(subir, 0.0))
        espera, tope, aviso = _resolver_espera(
            ruta[0]["linea"],
            pasadas(ruta[0]["linea"], subir, _indice_subida(ruta[0], red)),
            hasta_la_parada,
            subir in andando_origen,
            horarios_map, tipo_dia, ahora_min,
            intervalo_fn=intervalo_linea, en_servicio_fn=servicio_linea,
        )
        # The transfer is reached after the walk TO THE FIRST STOP and the ride. The
        # walk at the destination happens after leaving the last bus, not before
        # boarding the second one. To count it here would advance the clock and pick
        # the wrong connecting bus.
        transbordo = _espera_en_transbordos(
            ruta, red, paradas, esperas, horarios_map, tipo_dia, ahora_min,
            hasta_la_parada + (espera or 0), reales_map,
            viaje_tramo=viaje_tramo, pasadas_fn=pasadas, intervalo_fn=intervalo_linea,
        )
        # Shown clock floor vs. generalized cost (`comparable`); see `Puntuada`.
        total = viaje + andando + (espera or 0) + transbordo
        comparable = (
            viaje
            + andando * PESO_ANDANDO
            + _espera_estimada(espera, tope)
            + transbordo
            + PENALIZACION_TRANSBORDO_MIN * (len(ruta) - 1)
        )
        puntuadas.append(Puntuada(
            total, comparable, viaje, espera, tope, andando, transbordo, aviso, ruta))

    if not puntuadas:
        return []
    # A line that does not run at this hour is not an alternative, so it is dropped. If
    # remain, they come back anyway, so the application can explain why instead of
    # saying there is no route, which would be false: there is one, but not now.
    circulan = [p for p in puntuadas if _circula(p)]
    puntuadas = circulan or puntuadas
    puntuadas.sort(key=_orden)
    # Duplicates are removed before the filter and the trim. Otherwise variants of the
    # same trip take the four slots and the good options are not seen.
    puntuadas = _sin_dominadas(
        _sin_rodeos(_una_por_combinacion(_fusionar_por_paradas(puntuadas)))
    )
    mejor = puntuadas[0].comparable
    # The much worse routes are dropped first, and only then the list is trimmed.
    # Otherwise a good route can fall outside the limit because of another one that
    # is dropped later.
    aceptables = [p for p in puntuadas if p.comparable <= mejor * FACTOR_DESCARTE]
    return [
        {
            "tramos": p.ruta,
            # With an unknown wait the total is a floor, not a promise: the frontend
            # says so ("from X"), and `aviso_espera` explains why.
            "total_min": round(p.total),
            "viaje_min": round(p.viaje),
            "espera_min": round(p.espera) if p.espera is not None else None,
            # The most it can take when the wait is unknown but the frequency is not.
            "espera_max_min": round(p.tope) if p.tope is not None else None,
            # The wait at the transfers, already inside the total.
            "espera_transbordo_min": round(p.transbordo) if p.transbordo else None,
            "andando_min": round(p.andando) if hay_caminata else None,
            "aviso_espera": p.aviso,
        }
        for p in aceptables[:LIMITE_RUTAS]
    ]


def cargar_paradas(data_dir: Path = DATA_DIR) -> dict[str, tuple[float, float]]:
    """From paradas.json: {id: (lat, lon)}."""
    datos = json.loads((data_dir / "paradas.json").read_text(encoding="utf-8"))
    return {p["id"]: (p["lat"], p["lon"]) for p in datos}
