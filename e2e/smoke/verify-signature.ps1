# Signature smoke, Windows: every file given carries a valid Authenticode signature.
#
# usage: pwsh e2e/smoke/verify-signature.ps1 <file> [<file> ...]
$ErrorActionPreference = "Stop"
if ($args.Count -eq 0) { throw "usage: verify-signature.ps1 <file> [<file> ...]" }
foreach ($file in $args) {
  $signature = Get-AuthenticodeSignature -FilePath $file
  if ($signature.Status -ne "Valid") {
    throw "verify-signature: $file is $($signature.Status): $($signature.StatusMessage)"
  }
  Write-Output "verify-signature: $file is signed by $($signature.SignerCertificate.Subject)"
}
