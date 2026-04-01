import Foundation
import PopeyeAPI

enum SetupCardID: String, CaseIterable, Identifiable, Hashable {
    case daemon
    case github
    case gmail
    case googleCalendar = "google_calendar"
    case telegram

    var id: String { rawValue }

    var title: String {
        switch self {
        case .daemon: "Daemon & Auth"
        case .github: "GitHub"
        case .gmail: "Gmail"
        case .googleCalendar: "Google Calendar"
        case .telegram: "Telegram"
        }
    }

    var systemImage: String {
        switch self {
        case .daemon: "desktopcomputer"
        case .github: "chevron.left.forwardslash.chevron.right"
        case .gmail: "envelope.badge"
        case .googleCalendar: "calendar.badge.clock"
        case .telegram: "paperplane.circle"
        }
    }
}

enum SetupCardState: String, CaseIterable, Identifiable {
    case connected
    case missing
    case degraded
    case reauthRequired = "reauth_required"

    var id: String { rawValue }

    var isComplete: Bool {
        self == .connected
    }
}

enum SetupCardDestination: Equatable {
    case connections(id: String?)
    case telegram
}

struct SetupCardDetail: Identifiable, Equatable {
    let label: String
    let value: String

    var id: String { "\(label)-\(value)" }
}

struct SetupCard: Identifiable, Equatable {
    let id: SetupCardID
    let state: SetupCardState
    let summary: String
    let guidance: String
    let detailRows: [SetupCardDetail]
    let followUpRows: [SetupCardDetail]
    let followUpFootnote: String?
    let primaryAction: SetupCardAction?
    let supplementaryActions: [SetupCardAction]
    let destination: SetupCardDestination?
}

struct SetupSessionSnapshot {
    let connectionState: ConnectionState
    let baseURL: String
    let sseConnected: Bool
}
