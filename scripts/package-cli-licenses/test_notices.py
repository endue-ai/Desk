"""The Linux CLI ships the upstream notice from each locked crate's published revision."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from notices import crate_licenses


RUSSH_LICENSE_SHA256 = "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"
DELEGATE_LICENSE_SHA256 = "b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1"


class LockedCliNotices(unittest.TestCase):
    def license_for(self, name, version, revision):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".cargo_vcs_info.json").write_text(json.dumps({"git": {"sha1": revision}}))
            package = {"name": name, "version": version, "manifest_path": root / "Cargo.toml", "license_file": None}
            return crate_licenses(package, {})

    def test_locked_cli_crates_ship_their_original_license(self):
        crates = [
            ("delegate", "0.13.5", "b129d4cbf4cc499eff7743365dcb0fe5d8d2e820", "kobzol/rust-delegate",
             "LICENSE-APACHE", DELEGATE_LICENSE_SHA256),
            ("russh", "0.65.4", "4977b1afba8802137ac93f3e2c8bf916c35f437c", "warp-tech/russh",
             "LICENSE.txt", RUSSH_LICENSE_SHA256),
            ("russh-cryptovec", "0.62.0", "907c732562c5732aad6c140dba958eafddc41ba0", "warp-tech/russh",
             "LICENSE.txt", RUSSH_LICENSE_SHA256),
            ("russh-util", "0.52.0", "3d09c20c52a542ffa327723d3a44cb1edd9b0ca4", "warp-tech/russh",
             "LICENSE-2.0.txt", RUSSH_LICENSE_SHA256),
        ]
        for name, version, revision, repository, filename, digest in crates:
            with self.subTest(crate=name):
                notices = self.license_for(name, version, revision)
                url = f"https://github.com/{repository}/blob/{revision}/{filename}"
                self.assertEqual(set(notices), {url})
                self.assertEqual(hashlib.sha256(notices[url]).hexdigest(), digest)

    def test_unreviewed_revision_still_requires_a_notice(self):
        with self.assertRaisesRegex(ValueError, "missing redistribution notice"):
            self.license_for("russh", "0.65.4", "0" * 40)


if __name__ == "__main__":
    unittest.main()
