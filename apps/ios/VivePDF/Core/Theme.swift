import SwiftUI
import UIKit

/// Theme mode stored like the desktop app (`vivepdf.theme`).
enum ThemeMode: String, CaseIterable, Identifiable, Codable {
    case system, light, dark
    var id: String { rawValue }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
    var labelKey: String { "theme.\(rawValue)" }
}

/// Tool families; each has a colour pair (strong + soft) taken from `globals.css`.
enum Tone: String, CaseIterable, Identifiable, Codable {
    case organize, improve, toPdf, fromPdf, edit, security
    var id: String { rawValue }

    var color: Color {
        switch self {
        case .organize: Palette.dynamic(light: (202, 80, 34), dark: (202, 80, 62))
        case .improve: Palette.dynamic(light: (158, 62, 27), dark: (158, 55, 52))
        case .toPdf: Palette.dynamic(light: (22, 88, 37), dark: (24, 90, 62))
        case .fromPdf: Palette.dynamic(light: (262, 52, 48), dark: (262, 70, 72))
        case .edit: Palette.dynamic(light: (38, 92, 28), dark: (40, 92, 60))
        case .security: Palette.dynamic(light: (348, 68, 44), dark: (348, 80, 66))
        }
    }

    var soft: Color {
        switch self {
        case .organize: Palette.dynamic(light: (202, 80, 93), dark: (202, 60, 18))
        case .improve: Palette.dynamic(light: (158, 55, 91), dark: (158, 40, 15))
        case .toPdf: Palette.dynamic(light: (24, 90, 92), dark: (24, 50, 17))
        case .fromPdf: Palette.dynamic(light: (262, 60, 94), dark: (262, 40, 20))
        case .edit: Palette.dynamic(light: (40, 95, 90), dark: (40, 50, 16))
        case .security: Palette.dynamic(light: (348, 75, 94), dark: (348, 45, 18))
        }
    }

    var labelKey: String { "tools.grid.groups.\(rawValue)" }

    var symbol: String {
        switch self {
        case .organize: "square.grid.2x2"
        case .improve: "sparkles"
        case .toPdf: "doc.badge.plus"
        case .fromPdf: "square.and.arrow.up.on.square"
        case .edit: "pencil.line"
        case .security: "checkmark.shield"
        }
    }
}

/// Design tokens from `apps/desktop/src/styles/globals.css` (light / dark).
enum Palette {
    static let background = dynamic(light: (220, 14, 98), dark: (224, 20, 5))
    static let foreground = dynamic(light: (222, 20, 12), dark: (220, 14, 93))
    static let card = dynamic(light: (0, 0, 100), dark: (224, 16, 9))
    static let primary = dynamic(light: (202, 80, 36), dark: (202, 80, 55))
    static let primaryForeground = dynamic(light: (0, 0, 100), dark: (222, 16, 8))
    static let secondary = dynamic(light: (220, 14, 93), dark: (224, 14, 14))
    static let muted = dynamic(light: (220, 14, 94), dark: (224, 14, 12))
    static let mutedForeground = dynamic(light: (220, 9, 42), dark: (220, 9, 62))
    static let accent = dynamic(light: (202, 80, 94), dark: (202, 60, 20))
    static let accentForeground = dynamic(light: (202, 80, 26), dark: (202, 80, 85))
    static let destructive = dynamic(light: (0, 72, 45), dark: (0, 72, 62))
    static let success = dynamic(light: (152, 60, 30), dark: (152, 55, 48))
    static let warning = dynamic(light: (38, 92, 28), dark: (38, 90, 55))
    static let border = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.92, alpha: 0.11) : UIColor(red: 0.1, green: 0.12, blue: 0.16, alpha: 0.09) })

    static let groupTeal = dynamic(light: (174, 72, 28), dark: (172, 60, 48))
    static let groupCyan = dynamic(light: (192, 85, 34), dark: (190, 80, 56))
    static let groupIndigo = dynamic(light: (234, 58, 52), dark: (232, 80, 72))
    static let groupPink = dynamic(light: (326, 70, 46), dark: (326, 80, 70))
    static let groupLime = dynamic(light: (84, 70, 30), dark: (84, 62, 52))
    static let groupBrown = dynamic(light: (25, 45, 36), dark: (28, 45, 58))
    static let groupGray = dynamic(light: (220, 10, 44), dark: (220, 10, 62))

    static let radius: CGFloat = 10

    static func dynamic(light: (Double, Double, Double), dark: (Double, Double, Double)) -> Color {
        Color(UIColor { traits in
            let (h, s, l) = traits.userInterfaceStyle == .dark ? dark : light
            return hsl(h, s, l)
        })
    }

    static func hsl(_ h: Double, _ s: Double, _ l: Double, alpha: Double = 1) -> UIColor {
        let s = s / 100, l = l / 100
        let c = (1 - abs(2 * l - 1)) * s
        let hp = (h.truncatingRemainder(dividingBy: 360)) / 60
        let x = c * (1 - abs(hp.truncatingRemainder(dividingBy: 2) - 1))
        let (r1, g1, b1): (Double, Double, Double) = switch hp {
        case 0..<1: (c, x, 0)
        case 1..<2: (x, c, 0)
        case 2..<3: (0, c, x)
        case 3..<4: (0, x, c)
        case 4..<5: (x, 0, c)
        default: (c, 0, x)
        }
        let m = l - c / 2
        return UIColor(red: r1 + m, green: g1 + m, blue: b1 + m, alpha: alpha)
    }
}

// MARK: - Shared surface styles

struct CardBackground: ViewModifier {
    var padding: CGFloat = 16
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.border))
            .shadow(color: .black.opacity(0.05), radius: 12, y: 6)
    }
}

extension View {
    /// The white/dark rounded "card" used by every panel in the desktop app.
    func card(padding: CGFloat = 16) -> some View { modifier(CardBackground(padding: padding)) }
}

/// Soft aurora wash behind the home screen and tool pages, like the desktop shell.
struct AmbientBackground: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        ZStack {
            Palette.background
            GeometryReader { proxy in
                let size = max(proxy.size.width, proxy.size.height)
                Circle().fill(Color(Palette.hsl(202, 90, 60, alpha: scheme == .dark ? 0.30 : 0.14)))
                    .frame(width: size * 0.7).blur(radius: 90)
                    .offset(x: -size * 0.25, y: -size * 0.3)
                Circle().fill(Color(Palette.hsl(262, 70, 65, alpha: scheme == .dark ? 0.26 : 0.10)))
                    .frame(width: size * 0.6).blur(radius: 90)
                    .offset(x: proxy.size.width * 0.55, y: -size * 0.1)
                Circle().fill(Color(Palette.hsl(24, 90, 60, alpha: scheme == .dark ? 0.16 : 0.08)))
                    .frame(width: size * 0.5).blur(radius: 90)
                    .offset(x: proxy.size.width * 0.2, y: proxy.size.height * 0.7)
            }
        }
        .ignoresSafeArea()
    }
}
