"""Check native asset constraints without a simulator or app startup."""
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET
from PIL import Image

app = Path(__file__).resolve().parent.parent
android = "{http://schemas.android.com/apk/res/android}"
source = ET.parse(app / "assets/branding/umi-wordmark.svg").getroot()
_, _, width, height = map(float, source.attrib["viewBox"].split())
source_path = source.find("{http://www.w3.org/2000/svg}path")
surface = (255, 254, 250)
checked = set()


def png(relative, size, mode="RGB"):
    file = app / relative
    with Image.open(file) as image:
        assert image.size == (size, size), (relative, image.size, size)
        assert image.mode == mode, (relative, image.mode, mode)
        if mode == "RGB":
            assert image.getpixel((0, 0)) == surface, relative
            # Check every visible ink pixel against a conservative circular mask.
            radius = size * 0.4
            for y in range(size):
                for x in range(size):
                    if image.getpixel((x, y)) != surface:
                        assert math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= radius, relative
        else:
            assert image.getextrema()[3] == (0, 255), relative
            assert image.getbbox(), relative
    checked.add(relative)


for platform in ("ios", "macos"):
    catalog = f"{platform}/Runner/Assets.xcassets/AppIcon.appiconset"
    for asset in json.loads((app / catalog / "Contents.json").read_text())["images"]:
        pixels = int(float(asset["size"].split("x")[0]) * float(asset["scale"][:-1]))
        png(f"{catalog}/{asset['filename']}", pixels)
for density, size in zip(("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"), (48, 72, 96, 144, 192)):
    png(f"android/app/src/main/res/mipmap-{density}/ic_launcher.png", size)
for size in (192, 512):
    for name in ("Icon", "Icon-maskable"):
        png(f"web/icons/{name}-{size}.png", size)
png("web/favicon.png", 32)
for scale in (1, 2, 3):
    suffix = "" if scale == 1 else f"@{scale}x"
    png(f"ios/Runner/Assets.xcassets/LaunchImage.imageset/LaunchImage{suffix}.png", 288 * scale, "RGBA")

res = app / "android/app/src/main/res"
for name, canvas, diameter in (("umi_launcher_foreground", 108, 66), ("umi_splash", 288, 192)):
    vector = ET.parse(res / f"drawable/{name}.xml").getroot()
    assert float(vector.attrib[android + "viewportWidth"]) == canvas
    assert float(vector.attrib[android + "viewportHeight"]) == canvas
    group = vector.find("group")
    outline = group.find("path")
    assert outline.attrib[android + "pathData"] == source_path.attrib["d"]
    assert outline.attrib[android + "fillColor"] == source_path.attrib["fill"]
    sx, sy = (float(group.attrib[android + key]) for key in ("scaleX", "scaleY"))
    tx, ty = (float(group.attrib[android + key]) for key in ("translateX", "translateY"))
    assert sx == sy and sx > 0
    corners = [(tx + x * sx, ty + y * sy) for x in (0, width) for y in (0, height)]
    radius = max(math.hypot(x - canvas / 2, y - canvas / 2) for x, y in corners)
    assert radius < diameter / 2, (name, radius, diameter)
    print(f"{name}: full outline rectangle radius {radius:.4f}dp < {diameter / 2:.0f}dp")

with Image.open(app / "windows/runner/resources/app_icon.ico") as icon:
    expected = {(size, size) for size in (16, 24, 32, 48, 64, 128, 256)}
    assert icon.ico.sizes() == expected, icon.ico.sizes()
    for size in expected:
        entry = icon.ico.getimage(size)
        assert entry.size == size
        assert entry.getextrema()[3] == (255, 255), size

for relative in ("ios/Runner/Info.plist", "macos/Runner/Info.plist", "android/app/src/main/AndroidManifest.xml",
                 "android/app/src/debug/AndroidManifest.xml", "android/app/src/profile/AndroidManifest.xml",
                 "windows/runner/runner.exe.manifest",
                 "ios/Runner/Base.lproj/LaunchScreen.storyboard"):
    ET.parse(app / relative)
assert '"resources\\\\app_icon.ico"' in (app / "windows/runner/Runner.rc").read_text()
manifest = json.loads((app / "web/manifest.json").read_text())
for icon in manifest["icons"]:
    assert (app / "web" / icon["src"]).is_file()
assert manifest["background_color"] == manifest["theme_color"] == "#FFFEFA"
print(f"Checked {len(checked)} PNG files, seven ICO entries, both vector safe areas, and native/web manifests")
