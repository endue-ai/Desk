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

    def test_patched_ssh_source_carries_its_redistribution_notice(self):
        import json
        from notices import notices

        root = Path(__file__).resolve().parents[2]
        relative = Path("crates/compat/russh-util")
        package = {
            "name": "russh-util", "version": "0.52.0", "source": None,
            "manifest_path": str(root / relative / "Cargo.toml"),
            "license": "Apache-2.0", "license_file": None,
        }
        metadata = {"workspace_root": str(root), "packages": [package]}
        with patch("notices.cargo", side_effect=[json.dumps(metadata), "russh-util v0.52.0"]):
            files = notices()
        index = files["THIRD-PARTY-NOTICES.txt"].decode()
        self.assertIn("russh-util 0.52.0  Apache-2.0", index)
        self.assertIn(relative.as_posix(), index)
        self.assertNotIn(str(root), index)
        self.assertIn((root / relative / "LICENSE").read_bytes(), files.values())

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
