import Foundation

enum SetupActivity: Equatable {
    case oauthStarting(cardID: SetupCardID, kind: SetupOAuthActionKind)
    case oauthWaiting(cardID: SetupCardID, kind: SetupOAuthActionKind)
    case savingProviderAuth(cardID: SetupCardID)
    case savingTelegramSettings
    case applyingTelegramConfig
    case restartingDaemon

    var cardID: SetupCardID {
        switch self {
        case .oauthStarting(let cardID, _), .oauthWaiting(let cardID, _), .savingProviderAuth(let cardID):
            cardID
        case .savingTelegramSettings, .applyingTelegramConfig, .restartingDaemon:
            .telegram
        }
    }

    var message: String {
        switch self {
        case .oauthStarting(_, let kind):
            kind.progressTitle
        case .oauthWaiting(_, let kind):
            kind.waitingTitle
        case .savingProviderAuth:
            "Saving OAuth settings…"
        case .savingTelegramSettings:
            "Saving Telegram settings…"
        case .applyingTelegramConfig:
            "Applying Telegram bridge config…"
        case .restartingDaemon:
            "Scheduling daemon restart…"
        }
    }
}
