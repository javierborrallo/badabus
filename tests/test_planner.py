import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from badabus import planner

# Minimum test network:
#   A: 1 -> 2 -> 3 -> 4
#   B: 3 -> 5 -> 6   (shares stop 3 with A: a transfer is possible)
#   C: 2 -> 7        (shares stop 2 with A)
#   D: 1 -> 99       (exists in the network but does NOT run today)
RED = {
    "A": ["1", "2", "3", "4"],
    "B": ["3", "5", "6"],
    "C": ["2", "7"],
    "D": ["1", "99"],
}
# Only A, B and C run today (D stays out).
ACTIVAS = ["A", "B", "C"]
DIAS = {"LV": ACTIVAS, "SAB": ["A"], "DOM": []}


class TestPlanificar(unittest.TestCase):
    def plan(self, origen, destino, **kw):
        return planner.planificar(origen, destino, RED, ACTIVAS, **kw)

    def test_ruta_directa(self):
        rutas = self.plan("1", "4")
        self.assertIn([{"linea": "A", "subir": "1", "bajar": "4"}], rutas)
        # With a direct route it must not propose anything with transfers.
        self.assertTrue(all(len(r) == 1 for r in rutas))

    def test_un_transbordo(self):
        rutas = self.plan("1", "6")
        self.assertEqual(rutas, [[
            {"linea": "A", "subir": "1", "bajar": "3"},
            {"linea": "B", "subir": "3", "bajar": "6"},
        ]])

    def test_sin_ruta(self):
        self.assertEqual(self.plan("1", "inexistente"), [])

    def test_origen_igual_destino(self):
        # Same stop: there is no route (it avoids the "full loop" on circular lines).
        self.assertEqual(self.plan("2", "2"), [])

    def test_prefiere_directa_a_transbordo(self):
        # 2 -> 4 is direct on A: it must not mix in routes with a transfer.
        rutas = self.plan("2", "4")
        self.assertEqual(rutas, [[{"linea": "A", "subir": "2", "bajar": "4"}]])

    def test_solo_usa_lineas_activas(self):
        # 1 -> 99 would be possible only on line D, which does not run today.
        self.assertEqual(self.plan("1", "99"), [])

    def test_no_viaja_hacia_atras(self):
        # On A, stop 4 comes after stop 1, so 4 -> 1 is not reachable in that direction.
        self.assertEqual(self.plan("4", "1"), [])

    def test_respeta_max_transbordos(self):
        # 1 -> 6 needs a transfer: with max_transbordos=0 there is no route.
        self.assertEqual(self.plan("1", "6", max_transbordos=0), [])

    def test_conjunto_de_activas_distinto(self):
        # With only A active, 1 -> 6, which needs B, no longer exists.
        self.assertEqual(planner.planificar("1", "6", RED, ["A"]), [])
        self.assertEqual(
            planner.planificar("1", "4", RED, ["A"]),
            [[{"linea": "A", "subir": "1", "bajar": "4"}]],
        )


class TestTransbordoAndando(unittest.TestCase):
    # A: 1 -> 2      B: 3 -> 4      Stops 2 and 3 are different but neighbours.
    RED_PIE = {"A": ["1", "2"], "B": ["3", "4"], "D": ["2", "9"]}
    VECINAS = {"2": [("3", 0.1)], "3": [("2", 0.1)]}

    def test_sin_vecinas_no_hay_ruta(self):
        # Without the graph, a transfer requires the same stop: 1 -> 4 does not exist.
        self.assertEqual(
            planner.planificar_muchos(["1"], ["4"], self.RED_PIE, ["A", "B"]), []
        )

    def test_con_vecinas_se_baja_y_se_anda(self):
        rutas = planner.planificar_muchos(
            ["1"], ["4"], self.RED_PIE, ["A", "B"], vecinas=self.VECINAS
        )
        self.assertEqual(rutas, [[
            {"linea": "A", "subir": "1", "bajar": "2"},
            {"linea": "B", "subir": "3", "bajar": "4"},
        ]])

    def test_ofrece_las_dos_versiones_cuando_hay_transbordo_en_parada(self):
        # With the same lines there are two ways: alight early and walk, or stay on
        # to the common stop. The planner must not choose on its own: to measure in
        # stops ridden makes the walking one win, and it can be much worse.
        red = {"C": ["1", "2", "3"], "E": ["9", "3", "4"]}
        vecinas = {"2": [("9", 0.2)], "9": [("2", 0.2)]}
        rutas = planner.planificar_muchos(["1"], ["4"], red, ["C", "E"], vecinas=vecinas)
        formas = {tuple(a["bajar"] != b["subir"] for a, b in zip(r, r[1:], strict=False)) for r in rutas}
        self.assertIn((True,), formas, "falta la version andando")
        self.assertIn((False,), formas, "falta la version sin andar")

    def test_no_se_baja_antes_para_andar_a_donde_el_bus_llega(self):
        # C calls at 5, 6 and 7. To alight at 6 and walk to 7 is absurd: the bus goes there.
        red = {"C": ["5", "6", "7"], "E": ["7", "8"]}
        vecinas = {"6": [("7", 0.2)], "7": [("6", 0.2)]}
        rutas = planner.planificar_muchos(["5"], ["8"], red, ["C", "E"], vecinas=vecinas)
        for ruta in rutas:
            for anterior, siguiente in zip(ruta, ruta[1:], strict=False):
                self.assertEqual(
                    anterior["bajar"], siguiente["subir"],
                    "se baja antes para andar a una parada de su propia linea",
                )

    def test_no_se_anda_hacia_atras(self):
        # C calls at 5 before 6: after alighting at 6 you do not walk back to 5.
        red = {"C": ["5", "6"], "E": ["5", "7"]}
        vecinas = {"6": [("5", 0.1)], "5": [("6", 0.1)]}
        self.assertEqual(
            planner.planificar_muchos(["5"], ["7"], red, ["C", "E"], vecinas=vecinas),
            [[{"linea": "E", "subir": "5", "bajar": "7"}]],
        )

    def test_los_transbordos_de_siempre_siguen_saliendo(self):
        rutas = planner.planificar_muchos(
            ["1"], ["9"], self.RED_PIE, ["A", "D"], vecinas=self.VECINAS
        )
        self.assertEqual(rutas, [[
            {"linea": "A", "subir": "1", "bajar": "2"},
            {"linea": "D", "subir": "2", "bajar": "9"},
        ]])


# Real M2 route: it starts and ends at 1844 and serves the 1786-1788 branch in both directions.
M2 = [
    "1844", "1846", "1854", "1855", "1856", "1857", "1858", "1786", "1787", "191", "246",
    "240", "241", "160", "157", "201", "202", "207", "1867", "248", "236", "149", "153",
    "261", "141", "218", "219", "220", "1786", "1787", "1788", "1845", "1844",
]


class TestTramoEnSecuencia(unittest.TestCase):
    def test_ida_y_vuelta_en_ramal(self):
        i, j = planner.tramo_en_secuencia(M2, "1786", "1845")
        self.assertEqual((M2[i], M2[j], j - i), ("1786", "1845", 3))

    def test_cabecera_en_los_dos_extremos(self):
        self.assertEqual(planner.tramo_en_secuencia(M2, "202", "1844"), (16, len(M2) - 1))

    def test_gana_el_par_mas_corto(self):
        self.assertEqual(planner.tramo_en_secuencia(["a", "x", "a", "b"], "a", "b"), (2, 3))

    def test_empate_gana_el_primero(self):
        self.assertEqual(planner.tramo_en_secuencia(["a", "b", "a", "b"], "a", "b"), (0, 1))

    def test_subir_igual_a_bajar(self):
        self.assertIsNone(planner.tramo_en_secuencia(["a", "b", "a"], "a", "a"))

    def test_parada_ausente_o_sin_sentido(self):
        self.assertIsNone(planner.tramo_en_secuencia(["a", "b"], "a", "z"))
        self.assertIsNone(planner.tramo_en_secuencia(["a", "b"], "z", "b"))
        self.assertIsNone(planner.tramo_en_secuencia(["a", "b"], "b", "a"))


class TestParadasRepetidas(unittest.TestCase):
    def test_220_a_1787_en_m2_son_dos_paradas(self):
        rutas = planner.planificar("220", "1787", {"M2": M2}, ["M2"])
        self.assertEqual(rutas, [[{"linea": "M2", "subir": "220", "bajar": "1787"}]])
        self.assertEqual(planner._paradas_tramo(rutas[0][0], {"M2": M2}), 2)

    def test_el_coste_usa_el_tramo_mas_corto(self):
        tramo = {"linea": "M2", "subir": "1786", "bajar": "1845"}
        self.assertEqual(planner._paradas_tramo(tramo, {"M2": M2}), 3)

    def test_no_sube_y_baja_en_la_misma_parada(self):
        red = {"A": ["0", "8"], "L": ["1", "2", "1"]}
        vecinas = {"8": [("1", 0.1)], "1": [("8", 0.1)]}
        self.assertEqual(
            planner.planificar_muchos(["0"], ["1"], red, ["A", "L"], vecinas=vecinas), []
        )

    def test_dos_pasadas_no_duplican_la_bajada(self):
        # With two slots per stop, a duplicate from L pushes M out.
        red = {"L": ["1", "2", "1", "3"], "M": ["1", "3"], "N": ["3", "4"]}
        with mock.patch.object(planner, "CAMINOS_POR_PARADA", 2):
            rutas = planner.planificar_muchos(["1"], ["4"], red, ["L", "M", "N"])
        self.assertEqual(sorted(r[0]["linea"] for r in rutas), ["L", "M"])


class TestCargarDatos(unittest.TestCase):
    def test_lee_red_y_dias(self):
        with tempfile.TemporaryDirectory() as d:
            data_dir = Path(d)
            (data_dir / "red.json").write_text(json.dumps(RED), encoding="utf-8")
            (data_dir / "dias.json").write_text(json.dumps(DIAS), encoding="utf-8")
            red, dias = planner.cargar_datos(data_dir)
        self.assertEqual(red, RED)
        self.assertEqual(dias, DIAS)


if __name__ == "__main__":
    unittest.main()
