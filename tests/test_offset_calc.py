"""Pruebas unitarias sin dependencia de Moonraker en ejecucion.

Uso:
    python -m unittest discover -s tests

Solo ejercitan las partes puras de mks_suite_common.py (calculo de offset,
slugify, validacion de schema) -- SuitePaths/ProfileStore necesitan un objeto
'config' real de Moonraker y no se prueban aqui.
"""
import importlib.util
import json
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
COMMON_PATH = REPO_ROOT / "moonraker" / "components" / "mks_suite_common.py"
SCHEMA_DIR = REPO_ROOT / "schema"


def _load_common_module():
    # mks_suite_common.py vive dentro del paquete 'moonraker.components' en una
    # instalacion real; para probarlo aislado lo cargamos por ruta de archivo.
    spec = importlib.util.spec_from_file_location("mks_suite_common", COMMON_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


common = _load_common_module()


class ComputeIdexOffsetTests(unittest.TestCase):
    def test_t0_is_always_zero(self):
        self.assertEqual(common.compute_idex_offset(110, 110, 5, -3, "T0"), (0.0, 0.0))

    def test_t1_perfectly_aligned_gives_zero_offset(self):
        self.assertEqual(common.compute_idex_offset(110, 110, 110, 110, "T1"), (0.0, 0.0))

    def test_t1_offset_is_reference_minus_position(self):
        # T1 tuvo que moverse a (112.3, 108.7) para quedar centrado bajo la misma
        # referencia fisica que T0 veia en (110, 110): el offset a aplicar es
        # justo la diferencia, para que comandar X110 Y110 en T1 termine ahi.
        offset = common.compute_idex_offset(110, 110, 112.3, 108.7, "T1")
        self.assertEqual(offset, (-2.3, 1.3))

    def test_rounding_to_4_decimals(self):
        offset = common.compute_idex_offset(110, 110, 110.00001, 110, "T1")
        self.assertEqual(offset, (-0.0, 0.0))


class SlugifyTests(unittest.TestCase):
    def test_lowercases_and_hyphenates(self):
        self.assertEqual(common.slugify("Mi CoreXY IDEX!"), "mi-corexy-idex")

    def test_collapses_repeated_separators(self):
        self.assertEqual(common.slugify("a   b---c"), "a-b-c")

    def test_empty_input_has_fallback(self):
        self.assertEqual(common.slugify("¡¡¡"), "profile")

    def test_path_traversal_characters_are_stripped(self):
        # slugify() es lo que arma nombres de archivo de perfil: no debe dejar
        # pasar '..' ni separadores de ruta.
        result = common.slugify("../../etc/passwd")
        self.assertNotIn("/", result)
        self.assertNotIn("..", result)


class SchemaValidationTests(unittest.TestCase):
    def setUp(self):
        self.hw_schema = common.load_schema(SCHEMA_DIR, "hardware_profile.schema.json")

    def test_example_hardware_profile_is_valid(self):
        example_path = REPO_ROOT / "profiles" / "hardware" / "example_monster8_idex.json"
        profile = json.loads(example_path.read_text(encoding="utf-8"))
        # No debe lanzar.
        common.validate_against_schema(profile, self.hw_schema)

    def test_missing_required_field_is_rejected(self):
        broken = {"profile_id": "x", "name": "x", "kinematics": "cartesian", "toolheads": []}
        with self.assertRaises(Exception):
            common.validate_against_schema(broken, self.hw_schema)


if __name__ == "__main__":
    unittest.main()
