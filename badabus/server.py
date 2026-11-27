import datetime
import functools
import json
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

from badabus import bus_data_api as api
from badabus import dia, frecuencias, geocoder, planner, ranking

# Local only by default. To open it to the network, set BADABUS_HOST=0.0.0.0 in .env.
HOST_POR_DEFECTO = "127.0.0.1"
PORT = 8000
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
WEB_DIR = BASE_DIR / "web"
DATA_FILES = {"paradas.json", "lineas.json", "red.json", "shapes.json", "dias.json"}
ENV_FILE = BASE_DIR / ".env"
CONSULTAS_A_LA_VEZ = 8
# Per-request live stop query budgets for /api/plan (pass 1 and total).
MAX_INICIALES_EN_VIVO = 6
MAX_CONSULTAS_EN_VIVO = 8
MAX_PASADAS_EN_VIVO = 3
CACHE_ESPERAS_SEG = 30
DISTANCIA_MISMO_SITIO_KM = 0.15
WEB_FILES = {
    "index.html",
    "app.js",
    "i18n.js",
    "storage.js",
    "mapa.js",
    "vistas.js",
    "styles.css",
    "manifest.webmanifest",
    "sw.js",
    "icon.svg",
    "icon-192.png",
    "icon-512.png",
}
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/parada/"):
            self.handle_tiempos(path.removeprefix("/api/parada/"))
        elif path == "/api/plan":
            self.handle_plan()
        elif path == "/api/dia":
            self.handle_dia()
        elif path == "/api/config":
            self.handle_config()
        elif path == "/api/buscar":
            self.handle_buscar()
        elif path == "/api/direccion":
            self.handle_direccion()
        elif path.startswith("/data/"):
            self.handle_static(path.removeprefix("/data/"), DATA_DIR, DATA_FILES)
        elif path == "/":
            self.handle_static("index.html", WEB_DIR, WEB_FILES)
        elif path.lstrip("/") in WEB_FILES:
            self.handle_static(path.lstrip("/"), WEB_DIR, WEB_FILES)
        else:
            self.fail(404, "not found")

    def handle_static(self, name: str, directory: Path, allowed: set[str]) -> None:
        if name not in allowed:
            self.fail(404, "not found")
            return
        try:
            body = (directory / name).read_bytes()
        except OSError:
            self.fail(404, "not found")
            return
        content_type = CONTENT_TYPES.get(Path(name).suffix, "application/octet-stream")
        self.send_bytes(200, body, content_type)

    def handle_tiempos(self, stop_id: str) -> None:
        # isdigit() accepts digits that are not ASCII ("²" gets through): that
        # would travel on to the upstream service instead of a 400 answered here.
        if not (stop_id.isascii() and stop_id.isdigit()):
            self.fail(400, "invalid stop id")
            return
        try:
            data = api.fetch_json("tiempos", parada=stop_id)
            tiempos = api.parse_tiempos(data)
            guardar_en_cache_esperas(stop_id, ranking.esperas_por_linea(tiempos))
            body = json.dumps(tiempos, ensure_ascii=False).encode("utf-8")
        except (OSError, ValueError, KeyError, TypeError) as exc:
            print(f"  ! error asking for the arrivals of {stop_id}: {exc}")
            self.fail(502, "could not reach the service")
            return
        self.send_bytes(200, body, "application/json; charset=utf-8")

    def handle_plan(self) -> None:
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        params = parse_qs(query)
        try:
            paradas = ranking.cargar_paradas()
        except (OSError, ValueError):
            paradas = {}
        try:
            origen_ids, andando_origen = resolver_extremo(params, "origen", paradas)
            destino_ids, andando_destino = resolver_extremo(params, "destino", paradas)
        except ValueError as exc:
            self.fail(400, str(exc))
            return
        if not origen_ids or not destino_ids:
            aviso = "fuera de la red" if paradas else "sin datos de paradas"
            body = json.dumps(
                {"rutas": [], "aviso": aviso}, ensure_ascii=False
            )
            self.send_bytes(
                200, body.encode("utf-8"), "application/json; charset=utf-8"
            )
            return
        origen_id = (params.get("origen") or [""])[0]
        destino_id = (params.get("destino") or [""])[0]
        punto_o = punto_de_extremo(params, "origen", paradas)
        punto_d = punto_de_extremo(params, "destino", paradas)
        mismo_sitio = bool(origen_id and origen_id == destino_id)
        if not mismo_sitio and punto_o and punto_d:
            mismo_sitio = ranking.distancia_km(punto_o, punto_d) < DISTANCIA_MISMO_SITIO_KM
        if mismo_sitio:
            respuesta = {"rutas": [], "aviso": "ya_estas_ahi"}
            if punto_o and punto_d:
                km = ranking.distancia_km(punto_o, punto_d)
                respuesta["a_pie"] = {
                    "minutos": round(ranking.minutos_andando(km)),
                    "metros": round(km * ranking.FACTOR_CALLEJEO * 1000),
                }
            self.send_bytes(
                200,
                json.dumps(respuesta, ensure_ascii=False).encode("utf-8"),
                "application/json; charset=utf-8",
            )
            return
        try:
            red, dias = planner.cargar_datos()
            try:
                tipo, _ = dia.tipo_dia_actual()
            except (
                OSError,
                ValueError,
                KeyError,
                TypeError,
                AttributeError,
                IndexError,
            ) as exc:
                print(f"  ! could not ask for the day type, using the calendar: {exc}")
                tipo = dia.tipo_dia_local()
            activas = dias.get(tipo) or {lin for lins in dias.values() for lin in lins}
            rutas = planner.planificar_muchos(
                origen_ids, destino_ids, red, activas,
                vecinas=vecinas_de_paradas(paradas),
            )
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
            print(f"  ! error planning {origen_ids}->{destino_ids}: {exc}")
            self.fail(502, "could not work out a route")
            return
        # Query one furthest boarding stop per closest first-leg line, then refine finalists.
        iniciales = paradas_representativas(
            rutas, red, andando_origen=andando_origen, limite=MAX_INICIALES_EN_VIVO
        )
        consultadas = set(iniciales)
        esperas = esperas_en_vivo(iniciales)
        try:
            ahora = datetime.datetime.now()
            horarios = frecuencias.cargar()
            ahora_min = ahora.hour * 60 + ahora.minute
            puntuar = functools.partial(
                ranking.puntuar, red=red, paradas=paradas,
                andando_origen=andando_origen, andando_destino=andando_destino,
                horarios=horarios, tipo_dia=tipo, ahora_min=ahora_min,
                reales=distancias_reales(red, paradas),
            )
            elegidas = puntuar(rutas, esperas=esperas)
            # Refine finalists until all their boarding/transfer stops are queried.
            for _ in range(MAX_PASADAS_EN_VIVO):
                faltan = {
                    t["subir"] for r in elegidas for t in r["tramos"]
                } - consultadas
                if not faltan:
                    break
                cupo = max(0, MAX_CONSULTAS_EN_VIVO - len(consultadas))
                pedir = set(sorted(faltan)[:cupo]) if cupo < len(faltan) else faltan
                if not pedir:
                    break
                consultadas |= pedir
                esperas.update(esperas_en_vivo(pedir))
                elegidas = puntuar(rutas, esperas=esperas)
            rutas = elegidas
        except (
            OSError,
            ValueError,
            KeyError,
            TypeError,
            AttributeError,
            IndexError,
        ) as exc:
            print(f"  ! error scoring the routes: {exc}")
            rutas = [
                {
                    "tramos": ruta,
                    "total_min": None,
                    "viaje_min": None,
                    "espera_min": None,
                    "espera_max_min": None,
                    "andando_min": None,
                }
                for ruta in rutas[: ranking.LIMITE_RUTAS]
            ]
        respuesta = {"rutas": rutas}
        # To walk is also a way to get there, and for short trips it is the right
        # one: without this, a quarter of an hour of bus is offered for two hundred
        # metres. It is sent whenever both endpoints are known, and the frontend
        # decides.
        a_pie = self.a_pie(params, paradas)
        if a_pie:
            respuesta["a_pie"] = a_pie
        body = json.dumps(respuesta, ensure_ascii=False).encode("utf-8")
        self.send_bytes(200, body, "application/json; charset=utf-8")

    def a_pie(self, params: dict, paradas: dict) -> dict | None:
        """The direct walk from one endpoint to the other, if both of them are known."""
        origen = punto_de_extremo(params, "origen", paradas)
        destino = punto_de_extremo(params, "destino", paradas)
        if not origen or not destino:
            return None
        km = ranking.distancia_km(origen, destino)
        return {
            "minutos": round(ranking.minutos_andando(km)),
            "metros": round(km * ranking.FACTOR_CALLEJEO * 1000),
        }

    def handle_dia(self) -> None:
        try:
            tipo, etiqueta = dia.tipo_dia_actual()
        except (OSError, ValueError, KeyError, TypeError, AttributeError, IndexError) as exc:
            print(f"  ! error asking for the day type: {exc}")
            self.fail(502, "could not ask for the day type")
            return
        body = json.dumps({"tipo_dia": tipo, "etiqueta": etiqueta}, ensure_ascii=False).encode("utf-8")
        self.send_bytes(200, body, "application/json; charset=utf-8")

    def handle_config(self) -> None:
        """Settings the browser needs that do not live in the code, such as the map key."""
        # The file is passed explicitly: by default it would be fixed at import time.
        clave = leer_env(ENV_FILE).get("CARTO_API_KEY", "")
        body = json.dumps({"carto_key": clave}, ensure_ascii=False).encode("utf-8")
        self.send_bytes(200, body, "application/json; charset=utf-8")

    def handle_buscar(self) -> None:
        """Addresses that match the text, for the origin and destination search box."""
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        texto = (parse_qs(query).get("q") or [""])[0]
        if not texto.strip():
            self.send_bytes(200, b"[]", "application/json; charset=utf-8")
            return
        try:
            sitios = geocoder.buscar(texto)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            print(f"  ! error searching for the address {texto!r}: {exc}")
            self.fail(502, "could not search for the address")
            return
        body = json.dumps(sitios, ensure_ascii=False).encode("utf-8")
        self.send_bytes(200, body, "application/json; charset=utf-8")

    def handle_direccion(self) -> None:
        """Name of the place at some coordinates, for clicks on the map."""
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        params = parse_qs(query)
        try:
            lat = float((params.get("lat") or [""])[0])
            lon = float((params.get("lon") or [""])[0])
        except ValueError:
            self.fail(400, "lat and lon must be numbers")
            return
        try:
            nombre = geocoder.direccion(lat, lon)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            # Without a name the route is calculated all the same: it does not deserve an error.
            print(f"  ! could not name the point {lat},{lon}: {exc}")
            nombre = ""
        body = json.dumps({"nombre": nombre}, ensure_ascii=False).encode("utf-8")
        self.send_bytes(200, body, "application/json; charset=utf-8")

    def send_bytes(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        # Nothing served here survives being stored: the arrivals are a second old,
        # and the files in web/ change while they are being worked on. Without this the
        # browser keeps an old version and says nothing, and time goes into debugging
        # something that was already fixed.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def fail(self, status: int, message: str) -> None:
        body = json.dumps({"error": message}, ensure_ascii=False).encode("utf-8")
        self.send_bytes(status, body, "application/json; charset=utf-8")

    def reject(self) -> None:
        self.fail(405, "method not allowed")

    do_POST = do_PUT = do_DELETE = do_PATCH = reject

    def log_message(self, format: str, *args) -> None:
        pass


_VECINAS: dict | None = None


_TRAMOS_REALES: dict | None = None


def distancias_reales(red: dict, paradas: dict) -> dict:
    """Road metres between consecutive stops, computed only once.

    To walk the shapes costs about 200 ms and it does not change between queries.
    """
    global _TRAMOS_REALES
    if _TRAMOS_REALES is None:
        _TRAMOS_REALES = ranking.distancias_por_tramo(red, paradas, ranking.cargar_shapes())
    return _TRAMOS_REALES


def vecinas_de_paradas(paradas: dict) -> dict:
    """The graph of stops within walking distance of each other, computed only once.

    To build it whole costs about 30 ms and it does not change between queries, so there
    is no sense in redoing it on every request.
    """
    global _VECINAS
    if _VECINAS is None:
        _VECINAS = ranking.vecindad(paradas)
    return _VECINAS


_CACHE_ESPERAS: dict[str, tuple[float, float, dict]] = {}
_CACHE_LOCK = threading.Lock()


def limpiar_cache_esperas() -> None:
    """Forgets cached stop arrivals (for tests)."""
    with _CACHE_LOCK:
        _CACHE_ESPERAS.clear()


def guardar_en_cache_esperas(parada: str, esperas_linea: dict) -> None:
    """Stores parsed line waits for a stop in the shared TTL cache."""
    guardado = time.monotonic()
    expira = guardado + CACHE_ESPERAS_SEG
    with _CACHE_LOCK:
        _CACHE_ESPERAS[str(parada)] = (guardado, expira, dict(esperas_linea))


def paradas_representativas(
    rutas: list[list[dict]],
    red: dict,
    andando_origen: dict[str, float] | None = None,
    limite: int | None = None,
) -> set[str]:
    """Return the furthest boarding stop along each first-leg line in `rutas`."""
    por_linea: dict[str, set[str]] = {}
    for ruta in rutas:
        if not ruta:
            continue
        por_linea.setdefault(ruta[0]["linea"], set()).add(ruta[0]["subir"])

    caminata = andando_origen or {}
    lineas_ordenadas = sorted(
        por_linea.items(),
        key=lambda item: (min(caminata.get(p, 0.0) for p in item[1]), item[0]),
    )

    elegidas: set[str] = set()
    for linea, paradas_subida in lineas_ordenadas:
        if limite is not None and len(elegidas) >= limite:
            break
        seq = red.get(linea) or []
        ambiguas = ranking.paradas_ambiguas(seq)
        pos: dict[str, int] = {}
        for i, parada in enumerate(seq):
            pos.setdefault(parada, i)
        candidatas = [p for p in paradas_subida if p not in ambiguas] or paradas_subida
        elegidas.add(max(candidatas, key=lambda p: pos.get(p, -1)))
    return elegidas


def esperas_en_vivo(paradas: set) -> dict:
    """Minutes to the next bus of each line, per stop, with a short TTL cache.

    Cached values discount elapsed seconds so arrivals do not drift stale during
    the TTL window. If one stop fails, the rest still come back.
    """
    if not paradas:
        return {}

    ahora = time.monotonic()
    salida: dict[str, dict] = {}
    pedir: list[str] = []
    with _CACHE_LOCK:
        for p in paradas:
            entrada = _CACHE_ESPERAS.get(p)
            if entrada and ahora < entrada[1]:
                transcurrido = (ahora - entrada[0]) / 60.0
                salida[p] = {lin: max(0.0, esp - transcurrido) for lin, esp in entrada[2].items()}
            else:
                pedir.append(p)

    if not pedir:
        return salida

    def consultar(parada: str):
        try:
            tiempos = api.parse_tiempos(api.fetch_json("tiempos", parada=parada))
            return parada, ranking.esperas_por_linea(tiempos)
        except (OSError, ValueError, KeyError, TypeError):
            return parada, None

    with ThreadPoolExecutor(max_workers=CONSULTAS_A_LA_VEZ) as pool:
        nuevas = {p: e for p, e in pool.map(consultar, pedir) if e is not None}

    guardado = time.monotonic()
    expira = guardado + CACHE_ESPERAS_SEG
    with _CACHE_LOCK:
        for p, e in nuevas.items():
            _CACHE_ESPERAS[p] = (guardado, expira, e)
            salida[p] = dict(e)
    return salida


def punto_de_extremo(params: dict, prefijo: str, paradas: dict) -> tuple | None:
    """The coordinates of an endpoint, given either as a stop id or as a lat/lon pair."""
    ident = (params.get(prefijo) or [""])[0]
    if ident:
        return paradas.get(ident)
    lat = (params.get(f"{prefijo}_lat") or [""])[0]
    lon = (params.get(f"{prefijo}_lon") or [""])[0]
    try:
        return (float(lat), float(lon))
    except ValueError:
        return None


def resolver_extremo(
    params: dict, prefijo: str, paradas: dict
) -> tuple[list[str], dict[str, float]]:
    """From the parameters of an endpoint to (candidate stops, {id: km walked}).

    It takes `<prefix>=<id>` or `<prefix>_lat` + `<prefix>_lon`. In both cases the stops
    around it are considered too: to pick a stop by hand does not mean wanting *that*
    one and no other, and sometimes the next one has a line that suits much better. The
    chosen stop sits at zero metres, so no walk is charged to it.

    Raises ValueError if the parameters are not valid.
    """
    ident = (params.get(prefijo) or [""])[0]
    if ident:
        if not (ident.isascii() and ident.isdigit()):
            raise ValueError(f"{prefijo} must be a stop id")
        aqui = paradas.get(ident)
        if aqui is None:
            return [ident], {}
        cercanas = ranking.paradas_cercanas(aqui[0], aqui[1], paradas)
        return [p for p, _ in cercanas], {p: km for p, km in cercanas}
    lat = (params.get(f"{prefijo}_lat") or [""])[0]
    lon = (params.get(f"{prefijo}_lon") or [""])[0]
    if not lat or not lon:
        raise ValueError(f"{prefijo} is missing")
    cercanas = ranking.paradas_cercanas(float(lat), float(lon), paradas)
    return [p for p, _ in cercanas], {p: km for p, km in cercanas}


def leer_env(ruta: Path = ENV_FILE) -> dict[str, str]:
    """Reads a simple .env (KEY=value per line). If it is not there, returns {}."""
    valores: dict[str, str] = {}
    try:
        texto = ruta.read_text(encoding="utf-8")
    except OSError:
        return valores
    for linea in texto.splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, _, valor = linea.partition("=")
        valores[clave.strip()] = valor.strip().strip('"').strip("'")
    return valores


def ip_en_la_red() -> str:
    """The IP of this machine on the local network, to open the application from a phone."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return ""
    finally:
        sock.close()


def precargar_en_segundo_plano() -> None:
    """Warm static stop/shape indexes and day type on startup."""
    def tarea() -> None:
        try:
            paradas = ranking.cargar_paradas()
            red, _ = planner.cargar_datos()
            vecinas_de_paradas(paradas)
            distancias_reales(red, paradas)
        except (OSError, ValueError, KeyError, TypeError, IndexError):
            pass
        try:
            dia.tipo_dia_actual()
        except (OSError, ValueError, KeyError, TypeError, AttributeError, IndexError):
            pass

    threading.Thread(target=tarea, daemon=True).start()


def main() -> None:
    host = leer_env(ENV_FILE).get("BADABUS_HOST", HOST_POR_DEFECTO)
    server = ThreadingHTTPServer((host, PORT), Handler)
    precargar_en_segundo_plano()
    print(f"Serving on http://{host}:{PORT} (Ctrl+C to stop)")
    if host == "0.0.0.0":  # noqa: S104 — apertura deliberada, se pide en el .env
        ip = ip_en_la_red()
        if ip:
            print(f"From another device on the network: http://{ip}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
