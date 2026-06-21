import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

enum KDSTheme {

    // MARK: Brand palette — UMI Manual Corporativo
    enum Brand {
        /// UMI primary navy — #223979 (R:34 G:57 B:121).
        static let navy = Color(red: 34 / 255, green: 57 / 255, blue: 121 / 255)
        /// UMI primary cornflower blue — #7692CB (R:118 G:146 B:203).
        static let blue = Color(red: 118 / 255, green: 146 / 255, blue: 203 / 255)
        /// Adaptive primary: navy in light mode, cornflower blue in dark mode.
        /// Use for primary text and high-contrast elements on dynamic backgrounds.
        #if canImport(UIKit)
        static let navyAdaptive = Color(uiColor: UIColor { traits in
            switch traits.userInterfaceStyle {
            case .dark: UIColor(red: 118 / 255, green: 146 / 255, blue: 203 / 255, alpha: 1)
            default: UIColor(red: 34 / 255, green: 57 / 255, blue: 121 / 255, alpha: 1)
            }
        })
        #else
        static let navyAdaptive = navy
        #endif
    }

    // MARK: Dark surface hierarchy — UMI navy-anchored
    // All four levels share UMI navy's blue hue ratio, stepped by luminance (~6-8 units per tier).
    // Never use raw system colors for surfaces — they break the brand's navy warmth on dark mode.
    enum Surfaces {
        /// Board background — deepest layer.
        static let level0 = Color(red: 10 / 255, green: 15 / 255, blue: 30 / 255)
        /// Column container.
        static let level1 = Color(red: 16 / 255, green: 24 / 255, blue: 46 / 255)
        /// Card surface.
        static let level2 = Color(red: 22 / 255, green: 33 / 255, blue: 62 / 255)
        /// Metric tiles and detail panels.
        static let level3 = Color(red: 28 / 255, green: 42 / 255, blue: 76 / 255)
        /// Hairline separator / divider.
        static let separator = Color.white.opacity(0.07)
    }

    // MARK: Semantic color aliases
    enum Colors {
        static var boardBackground: Color { Surfaces.level0 }
        static var columnBackground: Color { Surfaces.level1 }
        static var cardBackground: Color { Surfaces.level2 }
        static var panelBackground: Color { Surfaces.level3 }
        static var detailBackground: Color { Surfaces.level1 }
        static let selectedCardBorder = Brand.blue
    }

    enum Connection {
        static func tint(for state: RealtimeConnectionState?, hasError: Bool = false) -> Color {
            switch state {
            case .connected:
                hasError ? .orange : .green
            case .connecting:
                .orange
            case .idle:
                Brand.blue
            case nil:
                .secondary
            }
        }
    }

    // MARK: Spacing
    enum Spacing {
        static let xs: CGFloat = 4
        static let small: CGFloat = 8
        static let medium: CGFloat = 12
        static let large: CGFloat = 20
        /// Inner padding for card content (leaves room for left status strip).
        static let cardPadding: CGFloat = 18
        /// Inner padding for column containers.
        static let columnPadding: CGFloat = 14
    }

    // MARK: Board layout
    enum BoardDensity {
        static let compactColumnWidth: CGFloat = 280
        static let regularMinColumnWidth: CGFloat = 235
        static let regularMaxColumnWidth: CGFloat = 320
    }

    // MARK: Liquid Glass tint opacities (iOS 26)
    // Applied via .glassEffect(Glass.regular.tint(color.opacity(n)), in: shape).
    // Keep glass only on chrome/pills — never on data-dense card surfaces.
    enum Glass {
        /// Nav badges, connection pills, status indicators.
        static let chromeTint: CGFloat = 0.10
        /// Status-colored chips where tint must stay legible.
        static let statusTint: CGFloat = 0.14
        /// Metric tiles and detail panel containers.
        static let panelTint: CGFloat = 0.08
    }
}
