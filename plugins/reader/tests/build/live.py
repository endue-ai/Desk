# Generated large-file QA fixtures; Python standard library only. Never run as a unit test.
from pathlib import Path
import random, struct, sys, zlib, zipfile
home = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/reader-large')
home.mkdir(parents=True, exist_ok=True)
# Forty actually visible uncompressed RGB images, each 7.5 MiB, plus short selectable text.
with (home/'raster-300mb.pdf').open('wb') as f:
    offsets = [0]
    def obj(n, body):
        while len(offsets) <= n: offsets.append(0)
        offsets[n] = f.tell(); f.write(f'{n} 0 obj\n'.encode()); f.write(body); f.write(b'\nendobj\n')
    f.write(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')
    obj(1,b'<< /Type /Catalog /Pages 2 0 R >>')
    kids=' '.join(f'{4+i*3} 0 R' for i in range(40))
    obj(2,f'<< /Type /Pages /Count 40 /Kids [{kids}] >>'.encode())
    obj(3,b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    for i in range(40):
        n=4+i*3
        obj(n,f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Image {n+2} 0 R >> >> /Contents {n+1} 0 R >>'.encode())
        content=f'BT /F1 20 Tf 36 756 Td (Range fixture - page {i+1}) Tj ET\nq 540 0 0 680 36 40 cm /Image Do Q'.encode()
        obj(n+1,f'<< /Length {len(content)} >>\nstream\n'.encode()+content+b'\nendstream')
        row=bytes(c for x in range(1024) for c in ((x//4+i*7)%256,(x//5+i*11)%256,170))
        image=row*2560
        obj(n+2,f'<< /Type /XObject /Subtype /Image /Width 1024 /Height 2560 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length {len(image)} >>\nstream\n'.encode()+image+b'\nendstream')
    start=f.tell(); f.write(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
    for offset in offsets[1:]: f.write(f'{offset:010d} 00000 n \n'.encode())
    f.write(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode())
# A readable image per chapter, stored ZIP entries. The first image is <1 MiB; the book is >100 MiB.
def chunk(kind, data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
rng=random.Random(189)
with zipfile.ZipFile(home/'illustrated-100mb.epub','w',compression=zipfile.ZIP_STORED) as z:
    z.writestr('mimetype','application/epub+zip')
    z.writestr('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="Book/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    manifest=[];spine=[]
    for i in range(134):
        raw=b''.join(b'\0'+rng.randbytes(512*3) for _ in range(512))
        png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',512,512,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw,1))+chunk(b'IEND',b'')
        z.writestr(f'Book/image{i}.png',png)
        z.writestr(f'Book/chapter{i}.xhtml',f'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter {i+1}</title></head><body><h1>Illustrated chapter {i+1}</h1><p>A generated large-file fixture. <a href="https://example.com/reader">Open example link</a></p><img src="image{i}.png" alt="Generated color texture"/><p><a href="chapter{(i+1)%134}.xhtml">Next chapter</a></p></body></html>')
        manifest.extend([f'<item id="c{i}" href="chapter{i}.xhtml" media-type="application/xhtml+xml"/>',f'<item id="i{i}" href="image{i}.png" media-type="image/png"/>']);spine.append(f'<itemref idref="c{i}"/>')
    z.writestr('Book/package.opf','<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Illustrated Range Book</dc:title><dc:identifier id="book">generated-189</dc:identifier><dc:language>en</dc:language></metadata><manifest>'+''.join(manifest)+'</manifest><spine>'+''.join(spine)+'</spine></package>')
for p in home.iterdir(): print(p.name,p.stat().st_size)
