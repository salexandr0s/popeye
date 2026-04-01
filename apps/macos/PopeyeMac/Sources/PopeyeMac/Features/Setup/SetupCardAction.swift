import Foundation

enum SetupOAuthActionKind: Equatable {
    case startSetup
    case reconnect
    case reauthorize

    var title: String {
        switch self {
        case .startSetup:
            "Start Setup"
        case .reconnect:
            "Reconnect"
        case .reauthorize:
            "Reauthorize"
        }
    }

    var progressTitle: String {
        switch self {
        case .startSetup:
            "Starting browser setup…"
        case .reconnect:
            "Starting reconnect flow…"
        case .reauthorize:
            "Starting reauthorization…"
        }
    }

    var waitingTitle: String {
        switch self {
        case .startSetup:
            "Waiting for browser authorization…"
        case .reconnect:
            "Waiting for reconnect to finish in the browser…"
        case .reauthorize:
            "Waiting for reauthorization to finish in the browser…"
        }
    }
}

enum SetupCardAction: Equatable {
    case oauth(kind: SetupOAuthActionKind, providerKind: String, connectionId: String?)
    case telegramConfigure
    case telegramApply
    case daemonRestart

    var title: String {
        switch self {
        case .oauth(let kind, _, _):
            kind.title
        case .telegramConfigure:
            "Configure Telegram…"
        case .telegramApply:
            "Apply Now"
        case .daemonRestart:
            "Restart Daemon"
        }
    }
}

struct TelegramSetupDraft: Equatable {
    var enabled = false
    var allowedUserId = ""
    var botToken = ""
    var currentSecretRefId: String?

    var normalizedAllowedUserId: String? {
        let trimmed = allowedUserId.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    var normalizedBotToken: String {
        botToken.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var canSubmit: Bool {
        enabled == false || normalizedAllowedUserId != nil
    }

    mutating func clearSensitiveFields() {
        botToken = ""
    }
}
