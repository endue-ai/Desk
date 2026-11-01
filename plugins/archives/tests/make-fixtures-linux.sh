#!/usr/bin/env bash
# The Linux half of make-fixtures.py, run in debian:bookworm-slim with the tree in /work/tree and the
# fixtures folder in /out. "main" makes 7z, deb, rpm, gem, cab, msi, arj, lha, disk images, WIM,
# SquashFS and a torrent; "rar" (on linux/amd64, where rar is packaged) makes the RAR 5 archive.
set -euo pipefail
export SOURCE_DATE_EPOCH=1790856000
cd /work/tree

if [ "$1" = rar ]; then
  sed -i "s/Components: main/Components: main non-free/" /etc/apt/sources.list.d/debian.sources
  apt-get update -qq >/dev/null && apt-get install -y -qq --no-install-recommends rar >/dev/null
  rar a -idq -ma5 -m0 /out/rar5.rar hello.txt docs/readme.md
  rar a -idq -ma5 -m3 /out/rar5.rar words.txt
  exit 0
fi

command -v 7zz >/dev/null || apt-get update -qq >/dev/null
command -v 7zz >/dev/null || apt-get install -y -qq --no-install-recommends 7zip rpm gcab wixl arj jlha-utils qemu-utils \
  wimtools squashfs-tools mktorrent fdisk ruby >/dev/null 2>&1

# 7z: a solid LZMA2 block with an encoded header; plain LZMA with a plain header; BCJ; copy.
7zz a -bd -bso0 -t7z -m0=LZMA2 -mx=9 -ms=on -mhc=on /out/solid.7z hello.txt docs data.bin words.txt
7zz a -bd -bso0 -t7z -m0=LZMA -ms=off -mhc=off /out/plain.7z hello.txt docs/readme.md
7zz a -bd -bso0 -t7z -m0=BCJ -m1=LZMA2 -mhc=off /out/bcj.7z data.bin words.txt
7zz a -bd -bso0 -t7z -m0=Copy -mhc=off /out/copy.7z hello.txt image.png

# Debian packages: xz (dpkg's default) and gzip.
mkdir -p /work/deb/DEBIAN /work/deb/usr/share/doc/sample
printf '%s\n' "Package: sample" "Version: 1.0-1" "Architecture: all" \
  "Maintainer: Example <example@example.com>" \
  "Description: A sample package for the archives plugin's tests" > /work/deb/DEBIAN/control
cp hello.txt /work/deb/usr/share/doc/sample/
dpkg-deb --root-owner-group -Zxz --build /work/deb /out/sample_1.0-1_all.deb >/dev/null
dpkg-deb --root-owner-group -Zgzip --build /work/deb /out/sample-gzip.deb >/dev/null

# RPM with gzip, xz and zstd payloads.
mkdir -p /work/rpm/SPECS
cat > /work/rpm/SPECS/sample.spec <<'SPEC'
Name: sample
Version: 1.0
Release: 1
Summary: A sample package for the archives plugin's tests
License: Apache-2.0
BuildArch: noarch
%description
A sample package.
%install
mkdir -p %{buildroot}/opt/sample
cp /work/tree/hello.txt %{buildroot}/opt/sample/hello.txt
%files
/opt/sample/hello.txt
SPEC
for c in gz:w9.gzdio xz:w6.xzdio zst:w19.zstdio; do
  rpmbuild --quiet --define "_topdir /work/rpm" --define "_binary_payload ${c#*:}" \
    -bb /work/rpm/SPECS/sample.spec >/dev/null 2>&1
  mv /work/rpm/RPMS/noarch/*.rpm "/out/sample-${c%%:*}.rpm"
done

# A Ruby gem.
mkdir -p /work/gem/lib && cp hello.txt /work/gem/lib/
cat > /work/gem/sample.gemspec <<'GEM'
Gem::Specification.new do |s|
  s.name = "sample"
  s.version = "1.0.0"
  s.summary = "A sample gem for the archives plugin's tests"
  s.authors = ["Example"]
  s.files = ["lib/hello.txt"]
  s.license = "Apache-2.0"
end
GEM
(cd /work/gem && gem build --silent sample.gemspec -o /out/sample-1.0.0.gem >/dev/null)

# Cabinets: MSZIP (several 32 KB blocks) and stored.
gcab -c -z /out/mszip.cab hello.txt words.txt docs/readme.md
gcab -c /out/stored.cab hello.txt docs/readme.md

# An MSI, from a WiX source.
cat > /work/sample.wxs <<'WXS'
<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="Sample" Language="1033" Version="1.0.0" Manufacturer="Example"
           UpgradeCode="6f1c2b8e-7f3a-4c55-9d0e-1a2b3c4d5e6f">
    <Package InstallerVersion="200" Compressed="yes" Comments="A sample installer"/>
    <Media Id="1" Cabinet="sample.cab" EmbedCab="yes"/>
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFilesFolder">
        <Directory Id="INSTALLDIR" Name="Sample">
          <Component Id="Hello" Guid="0d5e6f70-8192-4a3b-8c4d-5e6f708192a3">
            <File Id="HelloTxt" Source="hello.txt" KeyPath="yes"/>
          </Component>
        </Directory>
      </Directory>
    </Directory>
    <Feature Id="Main" Level="1"><ComponentRef Id="Hello"/></Feature>
  </Product>
</Wix>
WXS
wixl -o /out/sample.msi /work/sample.wxs

# ARJ and LHA.
arj a -y /out/sample.arj hello.txt docs/readme.md words.txt >/dev/null
lha a /out/sample.lzh hello.txt docs/readme.md words.txt >/dev/null && rm -f /out/sample.bak

# Raw disk images (MBR, GPT) and virtual disks, kept gzipped: they are mostly zeros.
truncate -s 2M /work/mbr.img
printf 'label: dos\n,1M,83\n,,7\n' | sfdisk -q /work/mbr.img
truncate -s 2M /work/gpt.img
printf 'label: gpt\nsize=1M, type=L, name=root\ntype=U, name=efi\n' | sfdisk -q /work/gpt.img
qemu-img create -q -f vpc -o subformat=dynamic /work/disk.vhd 64M
qemu-img create -q -f vhdx /work/disk.vhdx 64M
qemu-img create -q -f vmdk /work/disk.vmdk 64M
qemu-img create -q -f qcow2 /work/disk.qcow2 64M
for f in mbr.img gpt.img disk.vhd disk.vhdx disk.vmdk disk.qcow2; do
  gzip -9 -n -c "/work/$f" > "/out/$f.gz"
done

# WIM with two images, SquashFS (a snap's xz, and gzip for the AppImage test), a torrent.
wimcapture /work/tree/docs /out/sample.wim "Sample" >/dev/null
wimappend /work/tree/docs /out/sample.wim "Second" >/dev/null
mksquashfs /work/tree/docs /out/sample.snap -comp xz -noappend -quiet
mksquashfs /work/tree/docs /out/sample.squashfs -comp gzip -noappend -quiet
mktorrent -a http://tracker.example/announce,http://backup.example/announce -l 15 -d \
  -c "A sample torrent" -o /out/tree.torrent /work/tree/docs >/dev/null
