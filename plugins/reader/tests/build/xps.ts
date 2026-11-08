// An XPS document built here: two FixedPages with paths in the abbreviated geometry syntax, solid,
// gradient and image brushes, a canvas with a render transform, opacity and a clip, and Glyphs in
// an obfuscated .odttf font (a stand-in TrueType file: its header and a few tables' worth of bytes).
import { zip } from "./archive";
import { png } from "./png";

export const FONT_GUID = "0B1A2C3D-4E5F-6071-8293-A4B5C6D7E8F9";
const NS = "http://schemas.microsoft.com/xps/2005/06";

/** A stand-in font: the TrueType version 0x00010000, then bytes enough to be obfuscated. */
export function fakeFont(): Uint8Array {
  const font = new Uint8Array(64);
  font.set([0x00, 0x01, 0x00, 0x00, 0x00, 0x04], 0);
  for (let i = 6; i < font.length; i++) font[i] = (i * 37) & 255;
  return font;
}

/** Obfuscate as the XPS spec says: the first 32 bytes XORed with the GUID's bytes, reversed. */
export function obfuscate(font: Uint8Array, guid: string): Uint8Array {
  const hex = guid.replace(/[^0-9a-f]/gi, "");
  const key = Array.from({ length: 16 }, (_, i) =>
    Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16),
  );
  const out = font.slice();
  for (let i = 0; i < 16; i++) {
    out[i] = (out[i] ?? 0) ^ (key[15 - i] ?? 0);
    out[i + 16] = (out[i + 16] ?? 0) ^ (key[15 - i] ?? 0);
  }
  return out;
}

const PAGE1 = `<FixedPage xmlns="${NS}" xmlns:x="http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key" Width="816" Height="1056" xml:lang="en-US">
<FixedPage.Resources><ResourceDictionary>
  <SolidColorBrush x:Key="Ink" Color="#FF202020"/>
</ResourceDictionary></FixedPage.Resources>
<Path Data="M 10,10 L 100,10 100,60 Z" Fill="#FF3366CC" Stroke="{StaticResource Ink}" StrokeThickness="2"/>
<Path Data="F1 M 120,10 C 130,10 140,20 140,30 A 5,5 0 0 1 150,40 H 170 V 60 Z">
  <Path.Fill><LinearGradientBrush StartPoint="120,0" EndPoint="170,0" MappingMode="Absolute">
    <LinearGradientBrush.GradientStops>
      <GradientStop Color="#FFFF0000" Offset="0"/><GradientStop Color="#800000FF" Offset="1"/>
    </LinearGradientBrush.GradientStops>
  </LinearGradientBrush></Path.Fill>
</Path>
<Canvas RenderTransform="1,0,0,1,50,200" Opacity="0.5" Clip="M 0,0 L 300,0 300,100 0,100 Z">
  <Glyphs FontUri="/Resources/Fonts/${FONT_GUID}.odttf" FontRenderingEmSize="24" OriginX="10" OriginY="40"
    UnicodeString="The lantern in XPS" Fill="#FF000000"/>
</Canvas>
<Path Data="M 400,100 L 600,100 600,300 400,300 Z">
  <Path.Fill><ImageBrush ImageSource="/Resources/Images/dot.png" Viewbox="0,0,2,2" ViewboxUnits="Absolute"
    Viewport="400,100,200,200" ViewportUnits="Absolute" TileMode="None"/></Path.Fill>
</Path>
<Path Stroke="#FF00AA00" StrokeThickness="1">
  <Path.Data><PathGeometry><PathFigure StartPoint="10,500" IsClosed="true">
    <PolyLineSegment Points="110,500 110,600"/>
  </PathFigure></PathGeometry></Path.Data>
</Path>
</FixedPage>`;

const PAGE2 = `<FixedPage xmlns="${NS}" Width="816" Height="1056">
<Path Data="M 0,0 L 816,0 816,1056 0,1056 Z">
  <Path.Fill><RadialGradientBrush Center="408,528" GradientOrigin="408,528" RadiusX="400" RadiusY="400" MappingMode="Absolute">
    <RadialGradientBrush.GradientStops>
      <GradientStop Color="#FFFFFFFF" Offset="0"/><GradientStop Color="#FFDDDDDD" Offset="1"/>
    </RadialGradientBrush.GradientStops>
  </RadialGradientBrush></Path.Fill>
</Path>
<Glyphs FontUri="/Resources/Fonts/${FONT_GUID}.odttf" FontRenderingEmSize="18" OriginX="72" OriginY="96"
  UnicodeString="The second page of the XPS" Indices=",60;;;,40" Fill="#FF101010"/>
</FixedPage>`;

export function xps(): Uint8Array {
  return zip([
    [
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="fdseq" ContentType="application/vnd.ms-package.xps-fixeddocumentsequence+xml"/>
<Default Extension="fdoc" ContentType="application/vnd.ms-package.xps-fixeddocument+xml"/>
<Default Extension="fpage" ContentType="application/vnd.ms-package.xps-fixedpage+xml"/>
<Default Extension="odttf" ContentType="application/vnd.ms-package.obfuscated-opentype"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
</Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="R1" Type="http://schemas.microsoft.com/xps/2005/06/fixedrepresentation" Target="/FixedDocSeq.fdseq"/>
</Relationships>`,
    ],
    [
      "FixedDocSeq.fdseq",
      `<FixedDocumentSequence xmlns="${NS}"><DocumentReference Source="Documents/1/FixedDoc.fdoc"/></FixedDocumentSequence>`,
    ],
    [
      "Documents/1/FixedDoc.fdoc",
      `<FixedDocument xmlns="${NS}"><PageContent Source="Pages/1.fpage" Width="816" Height="1056"/><PageContent Source="Pages/2.fpage"/></FixedDocument>`,
    ],
    ["Documents/1/Pages/1.fpage", PAGE1],
    ["Documents/1/Pages/2.fpage", PAGE2],
    [`Resources/Fonts/${FONT_GUID}.odttf`, obfuscate(fakeFont(), FONT_GUID)],
    ["Resources/Images/dot.png", png(2, 2, [250, 200, 20])],
  ]);
}
