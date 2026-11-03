// Export the approved wordmark from the tracked font. Run on macOS.
import Foundation
import CoreText
import CoreGraphics

let app = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let fontURL = app.appendingPathComponent("assets/fonts/BricolageGrotesque12pt-SemiBold.ttf")
guard let provider = CGDataProvider(url: fontURL as CFURL),
      let graphicsFont = CGFont(provider) else { fatalError("Cannot read the tracked font") }
let font = CTFontCreateWithGraphicsFont(graphicsFont, 1000, nil, nil)
// The approved .u-logo has letter-spacing: -1px at font-size: 29px.
let attributes: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTKernAttributeName as String): -1000.0 / 29.0,
]
let line = CTLineCreateWithAttributedString(NSAttributedString(string: "umi", attributes: attributes))
let combined = CGMutablePath()
var glyphCount = 0
for run in CTLineGetGlyphRuns(line) as! [CTRun] {
    let runFont = (CTRunGetAttributes(run) as NSDictionary)[kCTFontAttributeName] as! CTFont
    precondition(CTFontCopyPostScriptName(runFont) == "BricolageGrotesque12pt-SemiBold" as CFString,
                 "A fallback font cannot define the wordmark")
    let count = CTRunGetGlyphCount(run)
    var glyphs = [CGGlyph](repeating: 0, count: count)
    var positions = [CGPoint](repeating: .zero, count: count)
    CTRunGetGlyphs(run, CFRange(location: 0, length: count), &glyphs)
    CTRunGetPositions(run, CFRange(location: 0, length: count), &positions)
    for index in 0..<count {
        precondition(glyphs[index] != 0, "Missing glyph")
        guard let path = CTFontCreatePathForGlyph(runFont, glyphs[index], nil) else {
            fatalError("Cannot extract glyph")
        }
        combined.addPath(path, transform: CGAffineTransform(
            translationX: positions[index].x, y: positions[index].y))
        glyphCount += 1
    }
}
precondition(glyphCount == 3, "Expected three letters")
let bounds = combined.boundingBoxOfPath
var transform = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: -bounds.minX, ty: bounds.maxY)
guard let outline = combined.copy(using: &transform) else { fatalError("Cannot normalize the outline") }
func number(_ value: CGFloat) -> String {
    let value = abs(value) < 0.0000005 ? 0 : value
    return String(format: "%.6f", locale: Locale(identifier: "en_US_POSIX"), Double(value))
}
func point(_ value: CGPoint) -> String { "\(number(value.x)) \(number(value.y))" }
var commands: [String] = []
outline.applyWithBlock { pointer in
    let element = pointer.pointee
    switch element.type {
    case .moveToPoint: commands.append("M" + point(element.points[0]))
    case .addLineToPoint: commands.append("L" + point(element.points[0]))
    case .addQuadCurveToPoint:
        commands.append("Q" + point(element.points[0]) + " " + point(element.points[1]))
    case .addCurveToPoint:
        commands.append("C" + point(element.points[0]) + " " + point(element.points[1]) + " " + point(element.points[2]))
    case .closeSubpath: commands.append("Z")
    @unknown default: fatalError("Unknown path element")
    }
}
let svg = """
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \(number(bounds.width)) \(number(bounds.height))">
  <!-- BricolageGrotesque12pt-SemiBold.ttf; SIL OFL 1.1; tracking -1/29 em. -->
  <path fill="#172440" fill-rule="nonzero" d="\(commands.joined(separator: " "))"/>
</svg>

"""
let destination = app.appendingPathComponent("assets/branding/umi-wordmark.svg")
try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
try svg.write(to: destination, atomically: true, encoding: .utf8)
print("Exported umi: \(number(bounds.width)) × \(number(bounds.height)); \(glyphCount) glyphs; \(commands.count) commands")
