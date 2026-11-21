// Renders the desk's app icons from the brand's app icon, brand/endue/app-icon.svg (a square ink
// tile with the white mark, as endue.ai/design/app-icon.svg serves it), into
// apps/desk/shell/icons/: the PNGs (Linux and the tray), icon.ico (Windows) and icon.icns (macOS).
// The tile is drawn as it is and only its corners are rounded (a continuous-corner square, as macOS
// draws app icons). macOS sizes follow Apple's grid: an 824 px tile in a 1024 px canvas. macOS only
// (AppKit, iconutil).
//
//   swift scripts/app-icons.swift   (from the repository root; `just app-icons`)

import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let source = root.appendingPathComponent("brand/endue/app-icon.svg")
let out = root.appendingPathComponent("apps/desk/shell/icons")

func fail(_ why: String) -> Never {
    FileHandle.standardError.write(Data("app-icons: \(why)\n".utf8))
    exit(1)
}

guard let tile = NSImage(contentsOf: source) else { fail("cannot read \(source.path)") }

/// A square with continuous corners (the curvature eases in, as in Apple's app icon shape): each
/// corner is three cubic curves, scaled by `radius`.
func squircle(_ rect: CGRect, radius: CGFloat) -> CGPath {
    // One corner, as distances from its vertex:
    // (along the edge we arrive on, along the edge we leave on).
    let corner: [[(CGFloat, CGFloat)]] = [
        [(1.52866483, 0)],
        [(1.08849323, 0), (0.86840689, 0), (0.66993427, 0.06549600)],
        [(0.63149399, 0.07491100)],
        [(0.37282392, 0.16905899), (0.16905899, 0.37282392), (0.07491100, 0.63149399)],
        [(0.06549600, 0.66993427)],
        [(0, 0.86840689), (0, 1.08849323), (0, 1.52866483)],
    ]
    let r = min(radius, min(rect.width, rect.height) / 2 / 1.52866483)
    // Clockwise from the top right: each corner's vertex, and the directions back along the edge
    // we arrive on and along the edge we leave on.
    let vertices: [(CGPoint, CGVector, CGVector)] = [
        (CGPoint(x: rect.maxX, y: rect.minY), CGVector(dx: -1, dy: 0), CGVector(dx: 0, dy: 1)),
        (CGPoint(x: rect.maxX, y: rect.maxY), CGVector(dx: 0, dy: -1), CGVector(dx: -1, dy: 0)),
        (CGPoint(x: rect.minX, y: rect.maxY), CGVector(dx: 1, dy: 0), CGVector(dx: 0, dy: -1)),
        (CGPoint(x: rect.minX, y: rect.minY), CGVector(dx: 0, dy: 1), CGVector(dx: 1, dy: 0)),
    ]
    let path = CGMutablePath()
    for (vertex, back, on) in vertices {
        func point(_ p: (CGFloat, CGFloat)) -> CGPoint {
            CGPoint(
                x: vertex.x + (back.dx * p.0 + on.dx * p.1) * r,
                y: vertex.y + (back.dy * p.0 + on.dy * p.1) * r)
        }
        for step in corner {
            if step.count == 3 {
                path.addCurve(
                    to: point(step[2]), control1: point(step[0]), control2: point(step[1]))
            } else if path.isEmpty {
                path.move(to: point(step[0]))
            } else {
                path.addLine(to: point(step[0]))
            }
        }
    }
    path.closeSubpath()
    return path
}

/// The tile at `px` pixels, `inset` of the canvas left clear on each side, as PNG.
func render(_ px: Int, inset: CGFloat) -> Data {
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let cg = CGContext(
        data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0, space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { fail("no \(px) px context") }
    let side = CGFloat(px) * (1 - 2 * inset)
    let body = CGRect(x: CGFloat(px) * inset, y: CGFloat(px) * inset, width: side, height: side)
    cg.interpolationQuality = .high
    cg.addPath(squircle(body, radius: side * 0.225))
    cg.clip()
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: cg, flipped: false)
    tile.draw(in: body)
    NSGraphicsContext.restoreGraphicsState()
    let image = cg.makeImage()!
    let data = NSMutableData()
    let dest = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { fail("no \(px) px PNG") }
    return data as Data
}

func write(_ data: Data, _ name: String, in dir: URL = out) {
    do { try data.write(to: dir.appendingPathComponent(name)) } catch { fail("\(name): \(error)") }
}

/// Windows and Linux draw the tile edge to edge; macOS leaves Apple's grid margin (100 of 1024).
let full: CGFloat = 0
let apple: CGFloat = 100.0 / 1024.0

// The PNGs packager.json lists (Linux) and the tray's 32 px one (tray.rs).
let pngs = [("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256), ("icon.png", 512)]
for (name, px) in pngs {
    write(render(px, inset: full), name)
}

// icon.ico: PNG entries, as Windows has read them since Vista.
let icoSizes = [16, 24, 32, 48, 64, 256]
let images = icoSizes.map { render($0, inset: full) }
var ico = Data()
func le16(_ v: Int) { ico.append(contentsOf: [UInt8(v & 0xff), UInt8(v >> 8 & 0xff)]) }
func le32(_ v: Int) { le16(v & 0xffff); le16(v >> 16 & 0xffff) }
le16(0); le16(1); le16(icoSizes.count)
var offset = 6 + 16 * icoSizes.count
for (px, png) in zip(icoSizes, images) {
    ico.append(contentsOf: [UInt8(px % 256), UInt8(px % 256), 0, 0])  // 256 is written as 0
    le16(1); le16(32); le32(png.count); le32(offset)
    offset += png.count
}
images.forEach { ico.append($0) }
write(ico, "icon.ico")

// icon.icns: an iconset on Apple's grid, packed by iconutil.
let iconset = FileManager.default.temporaryDirectory
    .appendingPathComponent("desk-\(ProcessInfo.processInfo.globallyUniqueString).iconset")
try! FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for pt in [16, 32, 128, 256, 512] {
    write(render(pt, inset: apple), "icon_\(pt)x\(pt).png", in: iconset)
    write(render(pt * 2, inset: apple), "icon_\(pt)x\(pt)@2x.png", in: iconset)
}
let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
let icns = out.appendingPathComponent("icon.icns")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", icns.path]
try! iconutil.run()
iconutil.waitUntilExit()
try? FileManager.default.removeItem(at: iconset)
guard iconutil.terminationStatus == 0 else { fail("iconutil exited \(iconutil.terminationStatus)") }
print("app-icons: wrote \(out.path)")
