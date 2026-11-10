// Renders the Wealth Desk app icon to a 1024×1024 PNG.
// Usage: swift tools/make_icon.swift out.png
import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext

// Rounded-square background (macOS icon grid: 824pt body inset 100pt)
let body = CGRect(x: 100, y: 100, width: 824, height: 824)
let path = CGPath(roundedRect: body, cornerWidth: 185, cornerHeight: 185, transform: nil)
ctx.addPath(path)
ctx.clip()
let colors = [NSColor(red: 0.07, green: 0.33, blue: 0.27, alpha: 1).cgColor,
              NSColor(red: 0.16, green: 0.56, blue: 0.45, alpha: 1).cgColor] as CFArray
let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
ctx.drawLinearGradient(gradient, start: CGPoint(x: 100, y: 100), end: CGPoint(x: 924, y: 924), options: [])

// Bars
ctx.setFillColor(NSColor(white: 1, alpha: 0.22).cgColor)
for (i, h) in [180.0, 280.0, 380.0, 500.0].enumerated() {
    let r = CGRect(x: 230 + Double(i) * 150, y: 250, width: 96, height: h)
    ctx.addPath(CGPath(roundedRect: r, cornerWidth: 18, cornerHeight: 18, transform: nil))
    ctx.fillPath()
}

// Growth line
ctx.setStrokeColor(NSColor.white.cgColor)
ctx.setLineWidth(46)
ctx.setLineCap(.round)
ctx.setLineJoin(.round)
ctx.move(to: CGPoint(x: 240, y: 430))
ctx.addLine(to: CGPoint(x: 420, y: 560))
ctx.addLine(to: CGPoint(x: 560, y: 500))
ctx.addLine(to: CGPoint(x: 770, y: 760))
ctx.strokePath()
ctx.setFillColor(NSColor.white.cgColor)
ctx.fillEllipse(in: CGRect(x: 735, y: 725, width: 70, height: 70))

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
