import contextlib
import io
import json
import os
import tempfile
import unittest

from badabus import collector

LINEAS = (
    b'{"ok":true,"data":['
    b'{"id":"002_A","lin":"2","nombre":"LINEA 2","descripcion":"Ruta 2",'
    b'"color_fondo":"696969","color_texto":"000000","orden":"1"},'
    b'{"id":"TRIP_100007","lin":"M2","nombre":"LINEA M2","descripcion":"Campomanes",'
    b'"color_fondo":"f58322","color_texto":"000000","orden":"14"}]}'
)
PARADAS_2 = (
    b'{"ok":true,"data":['
    b'{"stop_code":"202","stop_name":"Plaza","lat":"38.87","lon":"-6.97","sentido":"1","secuencia":"1"}]}'
)
PARADAS_M2 = (
    b'{"ok":true,"data":['
    b'{"stop_code":"1844","stop_name":"Campomane","lat":"38.82","lon":"-6.92","sentido":"1","secuencia":"2"},'
    b'{"stop_code":"202","stop_name":"Plaza","lat":"38.87","lon":"-6.97","sentido":"1","secuencia":"5"}]}'
)


PLANOS_URLS = ("/datos/002_A.json", "/datos/TRIP_100007.json")


def fake(url, timeout=10):
    if "action=lineas" in url:
        return LINEAS
    if "action=paradas" in url and "linea=002_A" in url:
        return PARADAS_2
    if "action=paradas" in url and "linea=TRIP_100007" in url:
        return PARADAS_M2
    if "shape002_A.json" in url:
        return b'[{"shape_pt_lat":"38.87","shape_pt_lon":"-6.97","sentido":"1"}]'
    if "shapeTRIP_100007.json" in url:
        return (
            b'[{"shape_pt_lat":"38.82","shape_pt_lon":"-6.92","sentido":"1"},'
            b'{"shape_pt_lat":"38.80","shape_pt_lon":"-6.90","sentido":"2"}]'
        )
    if url.endswith(PLANOS_URLS):
        return b"[]"
    raise AssertionError("url inesperada: " + url)


class TestCollect(unittest.TestCase):
    def test_builds_stops_meta_and_red(self):
        stops, meta, red, shapes = collector.collect(fetcher=fake)
        by_id = {s["id"]: s for s in stops}
        self.assertEqual(sorted(by_id), ["1844", "202"])
        self.assertEqual(by_id["202"]["lineas"], ["2", "M2"])
        self.assertEqual(by_id["1844"]["lineas"], ["M2"])
        self.assertEqual(meta["M2"], {"color": "#f58322", "nombre": "Campomanes"})
        self.assertEqual(red["M2"], ["1844", "202"])
        self.assertEqual(red["2"], ["202"])
        self.assertEqual(shapes["M2"], {"1": [[38.82, -6.92]], "2": [[38.8, -6.9]]})
        self.assertEqual(shapes["2"], {"1": [[38.87, -6.97]]})

    def test_natural_key_orders_lines(self):
        names = ["M2", "2", "11", "C1", "9F", "9"]
        self.assertEqual(sorted(names, key=collector.natural_key), ["2", "9", "9F", "11", "C1", "M2"])

    def test_natural_key_empty_sorts_last(self):
        self.assertEqual(sorted(["M2", "", "2"], key=collector.natural_key), ["2", "M2", ""])

    def test_parada_valida(self):
        ok = {"stop_code": "1", "stop_name": "X", "lat": "38.8", "lon": "-6.9", "secuencia": "2"}
        self.assertTrue(collector.parada_valida(ok))
        self.assertFalse(collector.parada_valida({**ok, "lat": "abc"}))
        self.assertFalse(collector.parada_valida({"stop_code": "1"}))

    def test_skips_invalid_stops(self):
        paradas_mixtas = (
            b'{"ok":true,"data":['
            b'{"stop_code":"1","stop_name":"Buena","lat":"38.8","lon":"-6.9","sentido":"1","secuencia":"1"},'
            b'{"stop_code":"2","stop_name":"Mala","lat":"nan?","lon":"-6.9","sentido":"1","secuencia":"2"}]}'
        )

        def fake_mixto(url, timeout=10):
            if "action=lineas" in url:
                return LINEAS
            if url.endswith(PLANOS_URLS):
                return b"[]"
            return paradas_mixtas

        with contextlib.redirect_stdout(io.StringIO()):
            stops, _, red, _ = collector.collect(fetcher=fake_mixto)
        ids = {s["id"] for s in stops}
        self.assertIn("1", ids)
        self.assertNotIn("2", ids)
        self.assertEqual(red["2"], ["1"])

    def test_shape_malformado_no_aborta(self):
        def fake_shape_malo(url, timeout=10):
            if "action=lineas" in url:
                return LINEAS
            if "action=paradas" in url and "linea=002_A" in url:
                return PARADAS_2
            if "action=paradas" in url and "linea=TRIP_100007" in url:
                return PARADAS_M2
            if "shape002_A.json" in url:
                return b'[{"shape_pt_lat":"38.87","shape_pt_lon":"-6.97","sentido":"1"}]'
            if "shapeTRIP_100007.json" in url:
                return b'[{"falta":"claves"}]'
            if url.endswith(PLANOS_URLS):
                return b"[]"
            raise AssertionError("url inesperada: " + url)

        with contextlib.redirect_stdout(io.StringIO()):
            stops, meta, red, shapes = collector.collect(fetcher=fake_shape_malo)
        self.assertEqual(sorted({s["id"] for s in stops}), ["1844", "202"])
        self.assertEqual(sorted(red), ["2", "M2"])
        self.assertIn("2", shapes)
        self.assertNotIn("M2", shapes)

    def test_recolectar_dias(self):
        # M2 runs on LV but not on SAB. Line 2 runs only on SAB.
        def fake_corr(url, timeout=10):
            if "action=lineas" in url:
                return LINEAS
            if "action=correspondencias" in url and "linea=TRIP_100007" in url:
                return (
                    b'{"ok":true,"current_tipo_dia":"LV","data":'
                    b'{"LV":{"202":"L11"},"SAB":[],"DOM":[]}}'
                )
            if "action=correspondencias" in url and "linea=002_A" in url:
                return (
                    b'{"ok":true,"current_tipo_dia":"LV","data":'
                    b'{"LV":[],"SAB":{"202":""},"DOM":[]}}'
                )
            raise AssertionError("url inesperada: " + url)

        out = collector.recolectar_dias(fetcher=fake_corr)
        self.assertEqual(out, {"LV": ["M2"], "SAB": ["2"], "DOM": []})

    def test_recolectar_dias_error_no_aborta(self):
        def fake_corr(url, timeout=10):
            if "action=lineas" in url:
                return LINEAS
            if "linea=TRIP_100007" in url:
                return b'{"ok":true,"current_tipo_dia":"LV","data":{"LV":{"202":"L4"}}}'
            raise OSError("caido")

        with contextlib.redirect_stdout(io.StringIO()):
            out = collector.recolectar_dias(fetcher=fake_corr)
        self.assertEqual(out, {"LV": ["M2"]})

    def test_collect_aplica_el_recorrido_de_planos(self):
        def fake_planos(url, timeout=10):
            if url.endswith("/datos/TRIP_100007.json"):
                return b'[{"stop_code":"202"},{"stop_code":"1844"},{"stop_code":"202"}]'
            return fake(url, timeout)

        def fake_orden(url, timeout=10):
            if "action=paradas" in url and "linea=TRIP_100007" in url:
                return PARADAS_M2.replace(b'"secuencia":"5"', b'"secuencia":"1"')
            return fake_planos(url, timeout)

        _, _, red, _ = collector.collect(fetcher=fake_orden)
        self.assertEqual(red["M2"], ["202", "1844", "202"])

    def test_fallo_de_planos_conserva_el_orden_de_la_api(self):
        def fake_caido(url, timeout=10):
            if url.endswith(PLANOS_URLS):
                raise OSError("caido")
            return fake(url, timeout)

        salida = io.StringIO()
        with contextlib.redirect_stdout(salida):
            _, _, red, _ = collector.collect(fetcher=fake_caido)
        self.assertEqual(red["M2"], ["1844", "202"])
        self.assertIn("M2", salida.getvalue())

    def test_save_json_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "data", "x.json")
            collector.save_json({"a": 1}, p)
            with open(p, encoding="utf-8") as f:
                self.assertEqual(json.loads(f.read()), {"a": 1})


# Real M2 route: it starts and ends at 1844 and serves the 1786-1788 branch in both directions.
M2 = [
    "1844", "1846", "1854", "1855", "1856", "1857", "1858", "1786", "1787", "191", "246",
    "240", "241", "160", "157", "201", "202", "207", "1867", "248", "236", "149", "153",
    "261", "141", "218", "219", "220", "1786", "1787", "1788", "1845", "1844",
]


def _planos(*codigos):
    return [{"stop_code": c} for c in codigos]


class TestRecorridoConRepeticiones(unittest.TestCase):
    def test_m2_conserva_la_segunda_pasada_por_el_ramal(self):
        orden_api = list(dict.fromkeys(M2))
        salida = collector.recorrido_con_repeticiones(orden_api, _planos(*M2))
        self.assertEqual(salida, M2)
        self.assertEqual(salida[-6:], ["220", "1786", "1787", "1788", "1845", "1844"])

    def test_colapsa_duplicados_consecutivos(self):
        salida = collector.recorrido_con_repeticiones(
            ["230", "1863", "175"], _planos("230", "1863", "1863", "230", "175")
        )
        self.assertEqual(salida, ["230", "1863", "230", "175"])

    def test_ignora_filas_sin_parada_y_codigos_ajenos(self):
        planos = [
            {"stop_code": "1"}, None, "texto", {"stop_code": ""}, {}, {"stop_code": "999"}, {"stop_code": 2},
        ]
        self.assertEqual(collector.recorrido_con_repeticiones(["1", "2"], planos), ["1", "2"])

    def test_parada_ausente_va_tras_su_predecesora(self):
        salida = collector.recorrido_con_repeticiones(
            ["70", "38", "35", "39"], _planos("70", "38", "39", "38")
        )
        self.assertEqual(salida, ["70", "38", "35", "39", "38"])

    def test_varias_ausentes_seguidas_y_primera(self):
        salida = collector.recorrido_con_repeticiones(["1", "2", "3", "4", "5"], _planos("3", "5"))
        self.assertEqual(salida, ["1", "2", "3", "4", "5"])

    def test_orden_incoherente_devuelve_el_de_la_api(self):
        orden_api = ["1", "2", "3"]
        salida = io.StringIO()
        with contextlib.redirect_stdout(salida):
            resultado = collector.recorrido_con_repeticiones(orden_api, _planos("3", "2", "1"))
        self.assertEqual(resultado, orden_api)
        self.assertTrue(salida.getvalue())

    def test_cierra_cabecera_de_retorno_si_el_trazado_termina_en_ella(self):
        coords = {"150": (38.86672, -6.97429), "149": (38.86792, -6.97319)}
        shape = {"1": [[38.86672, -6.97429], [38.89, -6.95]], "2": [[38.89, -6.95], [38.86675, -6.97429]]}
        self.assertEqual(
            collector.cerrar_cabecera_retorno(["150", "149"], coords, shape),
            ["150", "149", "150"],
        )

    def test_no_cierra_cabecera_si_el_trazado_acaba_lejos_o_ya_cierra(self):
        coords = {"150": (38.86672, -6.97429), "149": (38.86792, -6.97319)}
        shape_lejos = {"2": [[38.89, -6.95], [38.86792, -6.97319]]}
        self.assertEqual(
            collector.cerrar_cabecera_retorno(["150", "149"], coords, shape_lejos),
            ["150", "149"],
        )
        shape_cerca = {"2": [[38.89, -6.95], [38.86672, -6.97429]]}
        self.assertEqual(
            collector.cerrar_cabecera_retorno(["150", "149", "150"], coords, shape_cerca),
            ["150", "149", "150"],
        )


if __name__ == "__main__":
    unittest.main()
