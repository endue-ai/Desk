"""The standalone Linux packager refuses build-machine paths and credential literals."""
import os
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

validate = runpy.run_path(str(Path(__file__).resolve().parents[1] / "package-cli.py"))["validate_binary"]


class BinaryPrivacy(unittest.TestCase):
    def setUp(self):
        self.elf = bytearray(64)
        self.elf[:6] = b"\x7fELF\x02\x01"
        self.elf[18:20] = b"\x3e\x00"

    def test_only_the_requested_linux_architecture_is_accepted(self):
        validate(self.elf)
        self.elf[18:20] = b"\xb7\x00"
        with self.assertRaisesRegex(ValueError, "x86_64"):
            validate(self.elf)

    def test_build_checkout_and_credential_markers_are_refused(self):
        path = "/tmp/fixture-private-checkout"
        with patch.dict(os.environ, GITHUB_WORKSPACE=path):
            with self.assertRaisesRegex(ValueError, "private build path"):
                validate(self.elf + (path + "/source.rs").encode())
        with self.assertRaisesRegex(ValueError, "credential marker"):
            validate(self.elf + b"gh" + b"p_" + b"x" * 36)


if __name__ == "__main__":
    unittest.main()
