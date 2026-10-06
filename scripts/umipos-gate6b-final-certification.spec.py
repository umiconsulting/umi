import importlib.util
import os
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ClosingCountConfigurationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.update(
            PUBLIC_API_URL="https://localhost",
            PUBLIC_DASHBOARD_URL="https://localhost",
            POSTGRES_DB="test",
            COMPOSE_PROJECT_NAME="test",
        )
        spec = importlib.util.spec_from_file_location(
            "gate6b", ROOT / "scripts/umipos-gate6b-final-certification.py"
        )
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def test_requires_fixture_cash_count_in_minor_units(self):
        prior = os.environ.pop("GATE6B_CLOSING_COUNT_MINOR_UNITS", None)
        try:
            with self.assertRaisesRegex(ValueError, "GATE6B_CLOSING_COUNT_MINOR_UNITS"):
                self.module.closing_count_minor_units()
        finally:
            if prior is not None:
                os.environ["GATE6B_CLOSING_COUNT_MINOR_UNITS"] = prior

    def test_accepts_non_negative_integer_fixture_count(self):
        os.environ["GATE6B_CLOSING_COUNT_MINOR_UNITS"] = "95501"
        self.assertEqual(self.module.closing_count_minor_units(), 95501)

    def test_rejects_invalid_fixture_count(self):
        os.environ["GATE6B_CLOSING_COUNT_MINOR_UNITS"] = "95.501"
        with self.assertRaisesRegex(ValueError, "non-negative integer"):
            self.module.closing_count_minor_units()


if __name__ == "__main__":
    unittest.main()
