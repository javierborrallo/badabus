import json
import re
from collections.abc import Callable
from pathlib import Path

from badabus import bus_data_api as api
from badabus.ranking import distancia_km


def collect(fetcher: Callable[..., bytes] = api.fetch) -> tuple[list[dict], dict, dict, dict]:
    """Downloads lines, stops and shapes. Returns (paradas, meta, red, shapes).

    - paradas: deduplicated by stop_code, with the lines that serve each one.
    - meta: {lin: {color, nombre}}.
    - red: {lin: [stop_code in route order]}.
    - shapes: {lin: {direction: [[lat, lon], ...]}}.
    """
    lineas = api.fetch_json("lineas", fetcher=fetcher)
    by_code: dict[str, dict] = {}
    red: dict[str, list[str]] = {}
    for linea in lineas:
        try:
            paradas = api.fetch_json("paradas", fetcher=fetcher, linea=linea["id"])
        except (OSError, ValueError) as exc:
            print(f"  ! line {linea['id']} failed: {exc}")
            continue
        validas = [p for p in paradas if parada_valida(p)]
        if len(validas) < len(paradas):
            print(f"  ! line {linea['lin']}: {len(paradas) - len(validas)} stops with invalid data, skipped")
        red[linea["lin"]] = [
            p["stop_code"] for p in sorted(validas, key=lambda p: int(p["secuencia"]))
        ]
        try:
            planos = api.fetch_recorrido(linea["id"], fetcher=fetcher)
            red[linea["lin"]] = recorrido_con_repeticiones(red[linea["lin"]], planos)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            print(f"  ! no line plan for line {linea['lin']}: {exc}")
        for p in validas:
            stop = by_code.setdefault(p["stop_code"], {
                "id": p["stop_code"],
                "nombre": p["stop_name"],
                "lat": float(p["lat"]),
                "lon": float(p["lon"]),
                "lineas": set(),
            })
            stop["lineas"].add(linea["lin"])
    stops = []
    for stop in by_code.values():
        stop["lineas"] = sorted(stop["lineas"], key=natural_key)
        stops.append(stop)
    meta = {
        linea["lin"]: {"color": "#" + linea["color_fondo"], "nombre": linea["descripcion"]}
        for linea in lineas
    }
    coords = {code: (stop["lat"], stop["lon"]) for code, stop in by_code.items()}
    shapes: dict[str, dict] = {}
    for linea in lineas:
        try:
            puntos = api.fetch_shape(linea["id"], fetcher=fetcher)
            shapes[linea["lin"]] = api.parse_shape(puntos)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            print(f"  ! no shape for line {linea['lin']}: {exc}")
            continue
        if linea["lin"] in red:
            red[linea["lin"]] = cerrar_cabecera_retorno(
                red[linea["lin"]], coords, shapes[linea["lin"]]
            )
    return stops, meta, red, shapes


def cerrar_cabecera_retorno(
    seq: list[str],
    coords: dict[str, tuple[float, float]],
    shape_linea: dict,
    umbral_km: float = 0.025,
) -> list[str]:
    """Appends `seq[0]` at the end when return shape direction '2' ends at the origin terminal."""
    if len(seq) < 2 or seq[-1] == seq[0] or seq[0] not in coords:
        return seq
    vuelta = shape_linea.get("2") if isinstance(shape_linea, dict) else None
    if not vuelta:
        return seq
    ultimo = vuelta[-1]
    if not isinstance(ultimo, (list, tuple)) or len(ultimo) < 2:
        return seq
    try:
        fin = (float(ultimo[0]), float(ultimo[1]))
    except (TypeError, ValueError):
        return seq
    if distancia_km(fin, coords[seq[0]]) <= umbral_km:
        return [*seq, seq[0]]
    return seq


def recorrido_con_repeticiones(orden_api: list[str], planos: list[dict]) -> list[str]:
    """Route of a line with its repeated stops, from the line plan.

    The result keeps the stops of `orden_api`, in the same order of first appearance.
    If the line plan does not agree with that order, the result is `orden_api`.
    """
    conocidas = set(orden_api)
    recorrido: list[str] = []
    for fila in planos:
        if not isinstance(fila, dict) or not fila.get("stop_code"):
            continue
        codigo = str(fila["stop_code"])
        if codigo in conocidas and (not recorrido or recorrido[-1] != codigo):
            recorrido.append(codigo)
    # Put each missing stop after the first appearance of its predecessor.
    for i, codigo in enumerate(orden_api):
        if codigo not in recorrido:
            recorrido.insert(recorrido.index(orden_api[i - 1]) + 1 if i else 0, codigo)
    if list(dict.fromkeys(recorrido)) != orden_api:
        print(f"  ! line plan does not match the API order, from stop {orden_api[:1]}: ignored")
        return orden_api
    return recorrido


def recolectar_dias(fetcher: Callable[..., bytes] = api.fetch) -> dict[str, list[str]]:
    """Which lines run on each day type, from the connections endpoint.

    Returns {"LV": [lin, ...], "SAB": [...], "DOM": [...]}. A line that does not run on
    a day brings that day as an empty list instead of a dict, and that is why it stays
    out of that day.
    """
    lineas = api.fetch_json("lineas", fetcher=fetcher)
    por_dia: dict[str, list[str]] = {}
    for linea in lineas:
        try:
            _, data = api.fetch_correspondencias(linea["id"], fetcher=fetcher)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            print(
                f"  ! no connections for line "
                f"{linea.get('lin', linea.get('id', '?'))}: {exc}"
            )
            continue
        for tipo, paradas in (data or {}).items():
            por_dia.setdefault(tipo, [])
            if isinstance(paradas, dict):
                por_dia[tipo].append(linea["lin"])
    return {tipo: sorted(lins, key=natural_key) for tipo, lins in por_dia.items()}


def save_json(obj: list | dict, path: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    data_dir = Path(__file__).resolve().parent.parent / "data"
    stops, meta, red, shapes = collect()
    save_json(stops, str(data_dir / "paradas.json"))
    save_json(meta, str(data_dir / "lineas.json"))
    save_json(red, str(data_dir / "red.json"))
    save_json(shapes, str(data_dir / "shapes.json"))
    dias = recolectar_dias()
    save_json(dias, str(data_dir / "dias.json"))
    print(
        f"Saved {len(stops)} stops, {len(meta)} lines, {len(red)} sequences, "
        f"{len(shapes)} shapes and the lines per day type "
        f"({', '.join(f'{t}:{len(v)}' for t, v in sorted(dias.items()))}) in {data_dir}"
    )


def parada_valida(parada: dict) -> bool:
    """True if the stop brings the minimum fields, parseable, to build the network."""
    try:
        int(parada["secuencia"])
        float(parada["lat"])
        float(parada["lon"])
    except (KeyError, ValueError, TypeError):
        return False
    return bool(parada.get("stop_code") and parada.get("stop_name"))


def natural_key(name: str) -> tuple[int, list[tuple[int, int, str]]]:
    if not name:
        return (2, [])
    parts = re.findall(r"\d+|\D+", name)
    key = [(0, int(p), "") if p.isdigit() else (1, 0, p) for p in parts]
    lead = 0 if name[:1].isdigit() else 1
    return (lead, key)


if __name__ == "__main__":
    main()
