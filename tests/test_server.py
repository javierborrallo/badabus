import contextlib
import io
import json
import math
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from badabus import bus_data_api, server


class TestServer(unittest.TestCase):
    def setUp(self):
        self._orig_fetch_json = bus_data_api.fetch_json
        self._orig_cargar_paradas = server.ranking.cargar_paradas
        self._orig_data_dir = server.DATA_DIR
        self._orig_web_dir = server.WEB_DIR
        self._tmp = tempfile.TemporaryDirectory()
        Path(self._tmp.name, "lineas.json").write_text('{"M2": {"color": "#DF3A01"}}', encoding="utf-8")
        Path(self._tmp.name, "dias.json").write_text('{"LV": ["A"], "SAB": []}', encoding="utf-8")
        Path(self._tmp.name, "index.html").write_text(
            "<!doctype html><html><body>ok</body></html>", encoding="utf-8"
        )
        Path(self._tmp.name, "app.js").write_text("// app", encoding="utf-8")
        Path(self._tmp.name, "styles.css").write_text("/* css */", encoding="utf-8")
        Path(self._tmp.name, "manifest.webmanifest").write_text('{"name":"badabus"}', encoding="utf-8")
        Path(self._tmp.name, "sw.js").write_text("// sw", encoding="utf-8")
        Path(self._tmp.name, "icon.svg").write_text("<svg></svg>", encoding="utf-8")
        Path(self._tmp.name, "icon-192.png").write_bytes(b"\x89PNG\r\n\x1a\n")
        server.DATA_DIR = Path(self._tmp.name)
        server.WEB_DIR = Path(self._tmp.name)
        # Stubbed by default so that no test touches the network or the disk
        bus_data_api.fetch_json = lambda action, **kw: []
        server.ranking.cargar_paradas = lambda *a, **kw: {}
        self._orig_buscar = server.geocoder.buscar
        self._orig_direccion = server.geocoder.direccion
        server.geocoder.buscar = lambda *a, **kw: []
        server.geocoder.direccion = lambda *a, **kw: ""
        server.limpiar_cache_esperas()
        self.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        server.ranking.cargar_paradas = self._orig_cargar_paradas
        server.geocoder.buscar = self._orig_buscar
        server.geocoder.direccion = self._orig_direccion
        self.httpd.shutdown()
        self.httpd.server_close()
        bus_data_api.fetch_json = self._orig_fetch_json
        server.DATA_DIR = self._orig_data_dir
        server.WEB_DIR = self._orig_web_dir
        server.limpiar_cache_esperas()
        self._tmp.cleanup()

    def get(self, path):
        url = f"http://127.0.0.1:{self.port}{path}"
        try:
            with urllib.request.urlopen(url) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def test_tiempos_ok(self):
        bus_data_api.fetch_json = lambda action, **kw: [
            {"linea": "LÍNEA M2", "distancia": "21795m", "tiempo": "72 Minutos."}
        ]
        status, body = self.get("/api/parada/202")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), [
            {"linea": "LÍNEA M2", "metros": 21795, "tiempo": "72 Minutos."}
        ])

    def test_tiempos_invalid_id(self):
        status, _ = self.get("/api/parada/abc")
        self.assertEqual(status, 400)

    def test_tiempos_upstream_error(self):
        def boom(action, **kw):
            raise OSError("caido")
        bus_data_api.fetch_json = boom
        with contextlib.redirect_stdout(io.StringIO()):
            status, _ = self.get("/api/parada/202")
        self.assertEqual(status, 502)

    def test_data_allowed(self):
        status, body = self.get("/data/lineas.json")
        self.assertEqual(status, 200)
        self.assertIn("M2", json.loads(body))

    def test_data_not_allowlisted(self):
        status, _ = self.get("/data/secret.json")
        self.assertEqual(status, 404)

    def test_unknown_path(self):
        status, _ = self.get("/nope")
        self.assertEqual(status, 404)

    def test_serves_index_at_root(self):
        status, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn("html", body.decode("utf-8"))

    def test_serves_asset(self):
        status, _ = self.get("/app.js")
        self.assertEqual(status, 200)

    def test_serves_pwa_assets_with_content_types(self):
        casos = [
            ("/manifest.webmanifest", "application/manifest+json"),
            ("/sw.js", "text/javascript"),
            ("/icon.svg", "image/svg+xml"),
            ("/icon-192.png", "image/png"),
        ]
        for ruta, esperado in casos:
            cabeceras = self.cabeceras(ruta)
            self.assertIn(esperado, cabeceras["Content-Type"])

    def cabeceras(self, path):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}") as resp:
            return resp.headers

    def test_los_ficheros_no_se_quedan_cacheados(self):
        # Without this the browser serves an old app.js and says nothing, and time
        # goes into debugging something that was already fixed.
        self.assertEqual(self.cabeceras("/app.js")["Cache-Control"], "no-store")

    def test_los_tiempos_en_vivo_tampoco(self):
        # It matters more here: a stored arrival time is a false arrival time.
        bus_data_api.fetch_json = lambda action, **kw: []
        self.assertEqual(self.cabeceras("/api/parada/202")["Cache-Control"], "no-store")

    def test_unknown_asset_404(self):
        status, _ = self.get("/evil.js")
        self.assertEqual(status, 404)

    def test_data_traversal_blocked(self):
        status, _ = self.get("/data/..%2f..%2fserver.py")
        self.assertEqual(status, 404)

    def test_data_existing_but_not_allowlisted(self):
        status, _ = self.get("/data/app.js")
        self.assertEqual(status, 404)

    def test_config_sin_env_devuelve_clave_vacia(self):
        original = server.ENV_FILE
        server.ENV_FILE = Path(self._tmp.name, "no-existe.env")
        try:
            status, body = self.get("/api/config")
        finally:
            server.ENV_FILE = original
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"carto_key": ""})

    def test_config_lee_la_clave_del_env(self):
        env = Path(self._tmp.name, ".env")
        env.write_text("# comentario\nCARTO_API_KEY=abc123\n", encoding="utf-8")
        original = server.ENV_FILE
        server.ENV_FILE = env
        try:
            status, body = self.get("/api/config")
        finally:
            server.ENV_FILE = original
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"carto_key": "abc123"})

    def test_leer_env_ignora_comentarios_lineas_sueltas_y_comillas(self):
        env = Path(self._tmp.name, "otro.env")
        env.write_text('# nota\n\nCARTO_API_KEY="con comillas"\nSUELTA\n', encoding="utf-8")
        self.assertEqual(server.leer_env(env), {"CARTO_API_KEY": "con comillas"})

    def test_buscar_devuelve_direcciones(self):
        original = server.geocoder.buscar
        server.geocoder.buscar = lambda texto, **kw: [
            {"nombre": "12, Calle Menacho, Badajoz", "lat": 38.87, "lon": -6.97}
        ]
        try:
            status, body = self.get("/api/buscar?q=menacho")
        finally:
            server.geocoder.buscar = original
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)[0]["nombre"], "12, Calle Menacho, Badajoz")

    def test_buscar_sin_texto_devuelve_lista_vacia(self):
        status, body = self.get("/api/buscar")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), [])

    def test_buscar_con_el_servicio_caido(self):
        def boom(*a, **kw):
            raise OSError("caido")
        original = server.geocoder.buscar
        server.geocoder.buscar = boom
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                status, _ = self.get("/api/buscar?q=menacho")
        finally:
            server.geocoder.buscar = original
        self.assertEqual(status, 502)

    def test_direccion_devuelve_el_nombre(self):
        original = server.geocoder.direccion
        server.geocoder.direccion = lambda lat, lon, **kw: "12, Calle Menacho, Badajoz"
        try:
            status, body = self.get("/api/direccion?lat=38.87&lon=-6.97")
        finally:
            server.geocoder.direccion = original
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"nombre": "12, Calle Menacho, Badajoz"})

    def test_direccion_con_coordenadas_invalidas(self):
        status, _ = self.get("/api/direccion?lat=abc&lon=-6.97")
        self.assertEqual(status, 400)

    def test_direccion_con_el_servicio_caido(self):
        def boom(*a, **kw):
            raise OSError("caido")
        original = server.geocoder.direccion
        server.geocoder.direccion = boom
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                status, body = self.get("/api/direccion?lat=38.87&lon=-6.97")
        finally:
            server.geocoder.direccion = original
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"nombre": ""})

    def test_host_por_defecto_es_solo_local(self):
        self.assertEqual(server.HOST_POR_DEFECTO, "127.0.0.1")

    def test_el_env_puede_abrir_el_servidor_a_la_red(self):
        env = Path(self._tmp.name, "host.env")
        env.write_text("BADABUS_HOST=0.0.0.0\n", encoding="utf-8")
        self.assertEqual(server.leer_env(env).get("BADABUS_HOST"), "0.0.0.0")

    def test_sin_env_no_hay_host_configurado(self):
        env = Path(self._tmp.name, "vacio.env")
        env.write_text("CARTO_API_KEY=abc\n", encoding="utf-8")
        leido = server.leer_env(env)
        self.assertEqual(leido.get("BADABUS_HOST", server.HOST_POR_DEFECTO), "127.0.0.1")

    def _con_red(self, red, dias, paradas, ruta):
        """Runs one request with the test network in place, and leaves it as it was."""
        originales = (server.planner.cargar_datos, server.dia.tipo_dia_actual,
                      bus_data_api.fetch_json, server.ranking.cargar_paradas)
        server.planner.cargar_datos = lambda *a, **kw: (red, dias)
        server.dia.tipo_dia_actual = lambda *a, **kw: ("LV", "Horario L - V")
        server.ranking.cargar_paradas = lambda *a, **kw: paradas
        bus_data_api.fetch_json = lambda action, **kw: []
        try:
            return self.get(ruta)
        finally:
            (server.planner.cargar_datos, server.dia.tipo_dia_actual,
             bus_data_api.fetch_json, server.ranking.cargar_paradas) = originales

    def test_plan_ofrece_ir_andando(self):
        # Without this, a quarter of an hour of bus is proposed for two hundred metres.
        paradas = {"1": (38.880, -6.970), "2": (38.880, -6.968), "3": (38.880, -6.965)}
        status, body = self._con_red(
            {"A": ["1", "2", "3"]}, {"LV": ["A"]}, paradas,
            "/api/plan?origen_lat=38.880&origen_lon=-6.9700"
            "&destino_lat=38.880&destino_lon=-6.9690",
        )
        self.assertEqual(status, 200)
        datos = json.loads(body)
        self.assertIn("a_pie", datos)
        self.assertGreater(datos["a_pie"]["minutos"], 0)
        self.assertGreater(datos["a_pie"]["metros"], 0)

    def test_plan_sin_punto_conocido_no_inventa_la_caminata(self):
        paradas = {"1": (38.880, -6.970), "2": (38.880, -6.965)}
        status, body = self._con_red(
            {"A": ["1", "2"]}, {"LV": ["A"]}, paradas, "/api/plan?origen=1&destino=99")
        self.assertEqual(status, 200)
        # Stop 99 does not exist: with no destination point no walk is asserted.
        self.assertNotIn("a_pie", json.loads(body))

    def test_plan_ok(self):
        red = {"A": ["1", "2", "3"]}
        dias = {"LV": ["A"]}
        paradas = {"1": (38.88, -6.97), "2": (38.88, -6.96), "3": (38.88, -6.95)}
        orig_datos = server.planner.cargar_datos
        orig_dia = server.dia.tipo_dia_actual
        orig_fetch = bus_data_api.fetch_json
        orig_paradas = server.ranking.cargar_paradas
        server.planner.cargar_datos = lambda *a, **kw: (red, dias)
        server.dia.tipo_dia_actual = lambda *a, **kw: ("LV", "Horario L - V")
        server.ranking.cargar_paradas = lambda *a, **kw: paradas
        bus_data_api.fetch_json = lambda action, **kw: (
            [{"linea": "LÍNEA A", "distancia": "1000m", "tiempo": "5 Minutos."}]
            if kw.get("parada") == "1"
            else []
        )
        try:
            status, body = self.get("/api/plan?origen=1&destino=3")
        finally:
            server.planner.cargar_datos = orig_datos
            server.dia.tipo_dia_actual = orig_dia
            bus_data_api.fetch_json = orig_fetch
            server.ranking.cargar_paradas = orig_paradas
        self.assertEqual(status, 200)
        rutas = json.loads(body)["rutas"]
        self.assertEqual(rutas[0]["tramos"], [{"linea": "A", "subir": "1", "bajar": "3"}])
        self.assertEqual(rutas[0]["espera_min"], 5)
        # Picking stops by hand still looks at the ones next to them, so the walk
        # exists as a concept: 0 means there is nothing to walk.
        self.assertEqual(rutas[0]["andando_min"], 0)

    def test_plan_con_coordenadas_de_origen(self):
        red = {"A": ["1", "2", "3"]}
        dias = {"LV": ["A"]}
        paradas = {"1": (38.88, -6.97), "2": (38.88, -6.96), "3": (38.88, -6.95)}
        orig_datos = server.planner.cargar_datos
        orig_dia = server.dia.tipo_dia_actual
        orig_paradas = server.ranking.cargar_paradas
        server.planner.cargar_datos = lambda *a, **kw: (red, dias)
        server.dia.tipo_dia_actual = lambda *a, **kw: ("LV", "Horario L - V")
        server.ranking.cargar_paradas = lambda *a, **kw: paradas
        try:
            status, body = self.get("/api/plan?origen_lat=38.8801&origen_lon=-6.9701&destino=3")
        finally:
            server.planner.cargar_datos = orig_datos
            server.dia.tipo_dia_actual = orig_dia
            server.ranking.cargar_paradas = orig_paradas
        self.assertEqual(status, 200)
        rutas = json.loads(body)["rutas"]
        self.assertTrue(rutas, "debería encontrar ruta desde una parada cercana")
        self.assertIsInstance(rutas[0]["andando_min"], int)

    def test_plan_con_direccion_fuera_de_la_red(self):
        red = {"A": ["1", "2", "3"]}
        dias = {"LV": ["A"]}
        paradas = {"1": (38.88, -6.97), "2": (38.88, -6.96), "3": (38.88, -6.95)}
        orig_datos = server.planner.cargar_datos
        orig_dia = server.dia.tipo_dia_actual
        orig_paradas = server.ranking.cargar_paradas
        server.planner.cargar_datos = lambda *a, **kw: (red, dias)
        server.dia.tipo_dia_actual = lambda *a, **kw: ("LV", "Horario L - V")
        server.ranking.cargar_paradas = lambda *a, **kw: paradas
        try:
            status, body = self.get("/api/plan?origen_lat=40.0&origen_lon=-3.0&destino=3")
        finally:
            server.planner.cargar_datos = orig_datos
            server.dia.tipo_dia_actual = orig_dia
            server.ranking.cargar_paradas = orig_paradas
        self.assertEqual(status, 200)
        datos = json.loads(body)
        self.assertEqual(datos["rutas"], [])
        self.assertEqual(datos["aviso"], "fuera de la red")

    def test_plan_con_cargar_paradas_fallando(self):
        """When cargar_paradas fails, it returns 'sin datos de paradas'."""
        red = {"A": ["1", "2", "3"]}
        dias = {"LV": ["A"]}
        def falla(*a, **kw):
            raise OSError("sin datos")
        orig_datos = server.planner.cargar_datos
        orig_dia = server.dia.tipo_dia_actual
        orig_paradas = server.ranking.cargar_paradas
        server.planner.cargar_datos = lambda *a, **kw: (red, dias)
        server.dia.tipo_dia_actual = lambda *a, **kw: ("LV", "Horario L - V")
        server.ranking.cargar_paradas = falla
        try:
            # With coordinates, not an id, so that resolver_extremo is exercised
            status, body = self.get(
                "/api/plan?origen_lat=38.88&origen_lon=-6.97&destino=3"
            )
        finally:
            server.planner.cargar_datos = orig_datos
            server.dia.tipo_dia_actual = orig_dia
            server.ranking.cargar_paradas = orig_paradas
        self.assertEqual(status, 200)
        datos = json.loads(body)
        self.assertEqual(datos["rutas"], [])
        self.assertEqual(datos["aviso"], "sin datos de paradas")

    def test_plan_con_coordenadas_de_destino(self):
        """Coordenadas en destino (espejo de origen): encontrar ruta y andando_min int."""
        red = {"A": ["1", "2", "3"]}
        dias = {"LV": ["A"]}
        paradas = {"1": (38.88, -6.97), "2": (38.88, -6.96), "3": (38.88, -6.95)}
        orig_datos = server.planner.cargar_datos
        orig_dia = server.dia.tipo_dia_actual
        orig_paradas = server.ranking.cargar_paradas
        server.planner.cargar_datos = lambda *a, **kw: (red, dias)
        server.dia.tipo_dia_actual = lambda *a, **kw: ("LV", "Horario L - V")
        server.ranking.cargar_paradas = lambda *a, **kw: paradas
        try:
            status, body = self.get(
                "/api/plan?origen=1&destino_lat=38.8801&destino_lon=-6.9501"
            )
        finally:
            server.planner.cargar_datos = orig_datos
            server.dia.tipo_dia_actual = orig_dia
            server.ranking.cargar_paradas = orig_paradas
        self.assertEqual(status, 200)
        rutas = json.loads(body)["rutas"]
        self.assertTrue(rutas, "debería encontrar ruta hacia una parada cercana")
        self.assertIsInstance(rutas[0]["andando_min"], int)

    def test_plan_con_coordenadas_invalidas(self):
        status, _ = self.get("/api/plan?origen_lat=abc&origen_lon=-6.97&destino=3")
        self.assertEqual(status, 400)

    def test_plan_sin_tiempos_espera_es_none(self):
        red = {"A": ["1", "2", "3"]}
        dias = {"LV": ["A"]}
        paradas = {"1": (38.88, -6.97), "2": (38.88, -6.96), "3": (38.88, -6.95)}
        def boom(*a, **kw):
            raise OSError("sin tiempos")
        orig_datos = server.planner.cargar_datos
        orig_dia = server.dia.tipo_dia_actual
        orig_fetch = bus_data_api.fetch_json
        orig_paradas = server.ranking.cargar_paradas
        server.planner.cargar_datos = lambda *a, **kw: (red, dias)
        server.dia.tipo_dia_actual = lambda *a, **kw: ("LV", "Horario L - V")
        server.ranking.cargar_paradas = lambda *a, **kw: paradas
        bus_data_api.fetch_json = boom
        try:
            status, body = self.get("/api/plan?origen=1&destino=3")
        finally:
            server.planner.cargar_datos = orig_datos
            server.dia.tipo_dia_actual = orig_dia
            bus_data_api.fetch_json = orig_fetch
            server.ranking.cargar_paradas = orig_paradas
        self.assertEqual(status, 200)
        rutas = json.loads(body)["rutas"]
        self.assertIsNone(rutas[0]["espera_min"])
        self.assertIsInstance(rutas[0]["viaje_min"], int)

    def test_plan_sin_paradas_viaje_es_none(self):
        red = {"A": ["1", "2", "3"]}
        dias = {"LV": ["A"]}
        orig_datos = server.planner.cargar_datos
        orig_dia = server.dia.tipo_dia_actual
        orig_fetch = bus_data_api.fetch_json
        server.planner.cargar_datos = lambda *a, **kw: (red, dias)
        server.dia.tipo_dia_actual = lambda *a, **kw: ("LV", "Horario L - V")
        bus_data_api.fetch_json = lambda action, **kw: []
        # cargar_paradas already returns {} because of setUp
        try:
            status, body = self.get("/api/plan?origen=1&destino=3")
        finally:
            server.planner.cargar_datos = orig_datos
            server.dia.tipo_dia_actual = orig_dia
            bus_data_api.fetch_json = orig_fetch
        self.assertEqual(status, 200)
        rutas = json.loads(body)["rutas"]
        self.assertEqual(rutas[0]["tramos"], [{"linea": "A", "subir": "1", "bajar": "3"}])
        self.assertIsNone(rutas[0]["viaje_min"])
        self.assertIsNone(rutas[0]["espera_min"])

    def test_plan_invalid_ids(self):
        status, _ = self.get("/api/plan?origen=abc&destino=3")
        self.assertEqual(status, 400)

    def test_plan_missing_params(self):
        status, _ = self.get("/api/plan?origen=1")
        self.assertEqual(status, 400)

    def test_plan_upstream_error(self):
        def boom(*a, **kw):
            raise OSError("sin datos")
        original = server.planner.cargar_datos
        server.planner.cargar_datos = boom
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                status, _ = self.get("/api/plan?origen=1&destino=3")
        finally:
            server.planner.cargar_datos = original
        self.assertEqual(status, 502)

    def test_plan_malformed_data(self):
        # dias that is not a dict, a corrupt file -> a clean 502, not a 500 with a traceback.
        orig_datos = server.planner.cargar_datos
        orig_dia = server.dia.tipo_dia_actual
        server.planner.cargar_datos = lambda *a, **kw: ({"A": ["1", "2", "3"]}, [])
        server.dia.tipo_dia_actual = lambda *a, **kw: ("LV", "Horario L - V")
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                status, _ = self.get("/api/plan?origen=1&destino=3")
        finally:
            server.planner.cargar_datos = orig_datos
            server.dia.tipo_dia_actual = orig_dia
        self.assertEqual(status, 502)

    def test_plan_sin_dia_usa_el_calendario(self):
        # If the service does not answer, the planner still gives routes.
        red = {"A": ["1", "2", "3"]}
        dias = {tipo: ["A"] for tipo in ("LV", "SAB", "DOM")}
        def boom(*a, **kw):
            raise OSError("caido")
        orig_datos = server.planner.cargar_datos
        orig_dia = server.dia.tipo_dia_actual
        server.planner.cargar_datos = lambda *a, **kw: (red, dias)
        server.dia.tipo_dia_actual = boom
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                status, body = self.get("/api/plan?origen=1&destino=3")
        finally:
            server.planner.cargar_datos = orig_datos
            server.dia.tipo_dia_actual = orig_dia
        self.assertEqual(status, 200)
        rutas = json.loads(body)["rutas"]
        self.assertEqual(len(rutas), 1)
        self.assertEqual(rutas[0]["tramos"], [{"linea": "A", "subir": "1", "bajar": "3"}])
        self.assertIsNone(rutas[0]["viaje_min"])
        self.assertIsNone(rutas[0]["espera_min"])
        self.assertIsNone(rutas[0].get("total_min"))
        self.assertIsNone(rutas[0].get("andando_min"))

    def test_plan_error_puntuando_devuelve_rutas_sin_estimar(self):
        red = {"A": ["1", "2", "3"]}
        dias = {"LV": ["A"]}
        def boom(*a, **kw):
            raise ValueError("ranking roto")
        orig_datos = server.planner.cargar_datos
        orig_dia = server.dia.tipo_dia_actual
        orig_puntuar = server.ranking.puntuar
        server.planner.cargar_datos = lambda *a, **kw: (red, dias)
        server.dia.tipo_dia_actual = lambda *a, **kw: ("LV", "Horario L - V")
        server.ranking.puntuar = boom
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                status, body = self.get("/api/plan?origen=1&destino=3")
        finally:
            server.planner.cargar_datos = orig_datos
            server.dia.tipo_dia_actual = orig_dia
            server.ranking.puntuar = orig_puntuar
        self.assertEqual(status, 200)
        rutas = json.loads(body)["rutas"]
        self.assertEqual(rutas[0]["tramos"], [{"linea": "A", "subir": "1", "bajar": "3"}])
        self.assertIsNone(rutas[0]["viaje_min"])
        self.assertIsNone(rutas[0]["espera_min"])

    def test_dia_ok(self):
        original = server.dia.tipo_dia_actual
        server.dia.tipo_dia_actual = lambda *a, **kw: ("SAB", "Horario Sábado")
        try:
            status, body = self.get("/api/dia")
        finally:
            server.dia.tipo_dia_actual = original
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"tipo_dia": "SAB", "etiqueta": "Horario Sábado"})

    def test_dia_upstream_error(self):
        def boom(*a, **kw):
            raise OSError("caido")
        original = server.dia.tipo_dia_actual
        server.dia.tipo_dia_actual = boom
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                status, _ = self.get("/api/dia")
        finally:
            server.dia.tipo_dia_actual = original
        self.assertEqual(status, 502)

    def test_data_dias_allowed(self):
        status, body = self.get("/data/dias.json")
        self.assertEqual(status, 200)
        self.assertIn("LV", json.loads(body))

    def test_paradas_representativas_elige_la_mas_avanzada_de_cada_linea(self):
        red = {
            "A": ["10", "11", "12", "13", "14"],
            "B": ["20", "14", "21"],
        }
        rutas = [
            [],
            [{"linea": "A", "subir": "11", "bajar": "14"}],
            [{"linea": "A", "subir": "14", "bajar": "14"}],
            [{"linea": "B", "subir": "20", "bajar": "21"}],
            [{"linea": "B", "subir": "14", "bajar": "21"}],
            [{"linea": "X", "subir": "99", "bajar": "100"}],
        ]
        # A picks 14 (pos 4 > pos 1); B also picks 14 (deduplicated); missing X keeps 99;
        # empty routes are ignored.
        self.assertEqual(server.paradas_representativas(rutas, red), {"14", "99"})
        # With `limite`, lines reachable with a shorter walk from origin are prioritized.
        andando = {"11": 0.6, "14": 0.8, "20": 0.1, "99": 0.4}
        self.assertEqual(
            server.paradas_representativas(rutas, red, andando_origen=andando, limite=1),
            {"14"},
        )
        self.assertEqual(
            server.paradas_representativas(rutas, red, andando_origen=andando, limite=2),
            {"14", "99"},
        )

    def test_plan_refina_nueva_finalista_en_bucle_de_segunda_pasada(self):
        # Line A has two candidate boarding stops (1 and 2); furthest is 2.
        # Pass 1 queries stop 2 (bus A in 12 min), finalist is stop 1 (closer to origin),
        # so Pass 2 must query stop 1 directly and use its own observed wait (4 min).
        red = {"A": ["1", "2", "3"]}
        dias = {"LV": ["A"]}
        paradas = {"1": (38.880, -6.970), "2": (38.880, -6.968), "3": (38.880, -6.960)}
        pedidas = []

        def fake(action, **kw):
            pedidas.append(kw["parada"])
            if kw["parada"] == "2":
                return [{"linea": "LÍNEA A", "distancia": "2000m", "tiempo": "12 Minutos."}]
            if kw["parada"] == "1":
                return [{"linea": "LÍNEA A", "distancia": "800m", "tiempo": "4 Minutos."}]
            return []

        orig = (server.planner.cargar_datos, server.dia.tipo_dia_actual,
                bus_data_api.fetch_json, server.ranking.cargar_paradas)
        server.planner.cargar_datos = lambda *a, **kw: (red, dias)
        server.dia.tipo_dia_actual = lambda *a, **kw: ("LV", "Horario L - V")
        server.ranking.cargar_paradas = lambda *a, **kw: paradas
        bus_data_api.fetch_json = fake
        try:
            status, body = self.get("/api/plan?origen=1&destino=3")
        finally:
            (server.planner.cargar_datos, server.dia.tipo_dia_actual,
             bus_data_api.fetch_json, server.ranking.cargar_paradas) = orig
        self.assertEqual(status, 200)
        self.assertIn("1", pedidas)
        rutas = json.loads(body)["rutas"]
        self.assertEqual(rutas[0]["tramos"][0]["subir"], "1")
        self.assertEqual(rutas[0]["espera_min"], 4)

    def test_esperas_en_vivo_cachea_y_descuenta_tiempo_transcurrido(self):
        server.limpiar_cache_esperas()
        llamadas = []
        ahora = [1000.0]

        def fake(action, **kw):
            llamadas.append(kw["parada"])
            return [
                {"linea": "LÍNEA 5", "distancia": "500m", "tiempo": "3 Minutos."},
                {"linea": "LÍNEA 2", "distancia": "100m", "tiempo": "Próximo."},
                {"linea": "LÍNEA 9", "distancia": None, "tiempo": "Sin datos"},
            ]

        orig_fetch = bus_data_api.fetch_json
        orig_mono = server.time.monotonic
        bus_data_api.fetch_json = fake
        server.time.monotonic = lambda: ahora[0]
        try:
            primera = server.esperas_en_vivo({"201"})
            ahora[0] += 24.0  # 0.4 min elapsed, still within 30s TTL
            segunda = server.esperas_en_vivo({"201"})
        finally:
            bus_data_api.fetch_json = orig_fetch
            server.time.monotonic = orig_mono
            server.limpiar_cache_esperas()
        self.assertEqual(primera["201"]["5"], 3.0)
        self.assertAlmostEqual(segunda["201"]["5"], 2.6, places=6)
        self.assertEqual(segunda["201"]["2"], 0.0)
        self.assertEqual(segunda["201"]["9"], math.inf)
        self.assertEqual(llamadas, ["201"])

    def test_plan_no_reintenta_parada_fallida_en_segunda_pasada(self):
        red = {"A": ["1", "2"], "B": ["2", "3"]}
        dias = {"LV": ["A", "B"]}
        paradas = {"1": (38.880, -6.970), "2": (38.880, -6.966), "3": (38.880, -6.960)}
        pedidas = []

        def fake(action, **kw):
            pedidas.append(kw["parada"])
            if kw["parada"] == "2":
                raise OSError("parada 2 caida")
            return [{"linea": "LÍNEA A", "distancia": "500m", "tiempo": "3 Minutos."}]

        orig = (server.planner.cargar_datos, server.dia.tipo_dia_actual,
                bus_data_api.fetch_json, server.ranking.cargar_paradas)
        server.planner.cargar_datos = lambda *a, **kw: (red, dias)
        server.dia.tipo_dia_actual = lambda *a, **kw: ("LV", "Horario L - V")
        server.ranking.cargar_paradas = lambda *a, **kw: paradas
        bus_data_api.fetch_json = fake
        try:
            status, _ = self.get("/api/plan?origen=1&destino=3")
        finally:
            (server.planner.cargar_datos, server.dia.tipo_dia_actual,
             bus_data_api.fetch_json, server.ranking.cargar_paradas) = orig
        self.assertEqual(status, 200)
        self.assertEqual(pedidas.count("2"), 1)

    def test_plan_mismo_sitio_o_muy_cerca_no_propone_bus(self):
        paradas = {"204": (38.8780, -6.9700), "1877": (38.8795, -6.9700)}
        llamadas = []

        def fake(action, **kw):
            llamadas.append((action, kw))
            return []

        orig = (bus_data_api.fetch_json, server.ranking.cargar_paradas)
        bus_data_api.fetch_json = fake
        server.ranking.cargar_paradas = lambda *a, **kw: paradas
        try:
            s1, b1 = self.get("/api/plan?origen=1877&destino=1877")
            s2, b2 = self.get("/api/plan?origen_lat=38.8796&origen_lon=-6.9701&destino=1877")
        finally:
            bus_data_api.fetch_json, server.ranking.cargar_paradas = orig
        self.assertEqual(s1, 200)
        self.assertEqual(s2, 200)
        self.assertEqual(json.loads(b1)["rutas"], [])
        self.assertEqual(json.loads(b1)["aviso"], "ya_estas_ahi")
        self.assertEqual(json.loads(b2)["rutas"], [])
        self.assertEqual(json.loads(b2)["aviso"], "ya_estas_ahi")
        self.assertEqual(llamadas, [])

    def test_tiempos_rellena_cache_compartida(self):
        server.limpiar_cache_esperas()
        llamadas = []

        def fake(action, **kw):
            llamadas.append(kw["parada"])
            return [{"linea": "LÍNEA 3", "distancia": "300m", "tiempo": "5 Minutos."}]

        orig_fetch = bus_data_api.fetch_json
        bus_data_api.fetch_json = fake
        try:
            status, _ = self.get("/api/parada/201")
            cacheadas = server.esperas_en_vivo({"201"})
        finally:
            bus_data_api.fetch_json = orig_fetch
            server.limpiar_cache_esperas()
        self.assertEqual(status, 200)
        self.assertEqual(llamadas, ["201"])
        self.assertAlmostEqual(cacheadas["201"]["3"], 5.0, delta=0.1)

    def test_paradas_representativas_prefiere_no_ambigua(self):
        red = {"M2": ["1844", "1858", "1786", "1787", "202", "220", "1786", "1787", "1788", "1844"]}
        rutas = [
            [{"linea": "M2", "subir": "1858", "bajar": "202"}],
            [{"linea": "M2", "subir": "1786", "bajar": "202"}],
        ]
        self.assertEqual(server.paradas_representativas(rutas, red), {"1858"})
        # Terminal 1844 closes the loop, so it is unambiguous and preferred over mid-route 1786.
        con_cabecera = [
            [{"linea": "M2", "subir": "1844", "bajar": "202"}],
            [{"linea": "M2", "subir": "1786", "bajar": "202"}],
        ]
        self.assertEqual(server.paradas_representativas(con_cabecera, red), {"1844"})


if __name__ == "__main__":
    unittest.main()
