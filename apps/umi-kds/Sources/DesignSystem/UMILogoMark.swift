import SwiftUI

/// The authentic UMI mark — a crossing canopy that splays into a wide draped
/// embrace with upturned tips. Vector artwork extracted from the official
/// brand manual (Manual Corporativo - UMI.pdf) and shipped as the tintable
/// `UMIMark` asset. Width-to-height ratio is fixed at the manual's 2.2026 : 1.
enum UMIMark {
    /// Height as a fraction of the mark's width, per the brand artwork.
    static let heightRatio: CGFloat = 1 / 2.2026
}

/// The UMI mark rendered in a single tint. Uses the `UMIMark` template asset
/// so it scales crisply and recolors via `foregroundStyle`.
private struct UMIMarkImage: View {
    var color: Color

    var body: some View {
        Image("UMIMark")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .foregroundStyle(color)
    }
}

/// The UMI mark + "umi" wordmark stacked together.
/// Colors and sizes follow the brand manual's two-color principal usage.
struct UMILogoView: View {
    var markColor: Color = KDSTheme.Brand.navy
    var textColor: Color = KDSTheme.Brand.blue
    /// Total width of the logo. Height is derived from brand proportions.
    var width: CGFloat = 120

    private var markHeight: CGFloat { width * UMIMark.heightRatio }
    private var fontSize: CGFloat { width * 0.25 }

    var body: some View {
        VStack(spacing: width * 0.04) {
            UMIMarkImage(color: markColor)
                .frame(width: width, height: markHeight)

            Text("umi")
                .font(.system(size: fontSize, weight: .regular, design: .rounded))
                .foregroundStyle(textColor)
                .tracking(fontSize * 0.20)
        }
    }
}

/// Just the crossing mark without the wordmark — for tight spaces.
struct UMIMarkView: View {
    var color: Color = KDSTheme.Brand.navy
    var width: CGFloat = 44

    var body: some View {
        UMIMarkImage(color: color)
            .frame(width: width, height: width * UMIMark.heightRatio)
    }
}

#Preview("UMI Logo Variants") {
    VStack(spacing: 48) {
        UMILogoView(width: 160)

        HStack(spacing: 40) {
            UMILogoView(width: 80)
            UMIMarkView(width: 44)
        }

        UMILogoView(markColor: .white, textColor: .white, width: 120)
            .padding(28)
            .background(KDSTheme.Brand.navy)
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))

        UMILogoView(markColor: .white, textColor: .white, width: 100)
            .padding(24)
            .background(KDSTheme.Brand.blue)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
    .padding(48)
}
