import Foundation
import PopeyeAPI

extension SetupStore {
    func dismissTelegramSetup() {
        telegramSetupDraft.clearSensitiveFields()
        isPresentingTelegramSetup = false
    }

    func submitTelegramSetup() async {
        if telegramSetupDraft.enabled && telegramSetupDraft.normalizedAllowedUserId == nil {
            setActionError("Allowed Telegram user ID is required when Telegram is enabled.", for: .telegram)
            telegramSetupDraft.clearSensitiveFields()
            return
        }

        clearActionError()
        activity = .savingTelegramSettings
        defer { activity = nil }

        do {
            var secretRefID = telegramSetupDraft.currentSecretRefId

            if telegramSetupDraft.normalizedBotToken.isEmpty == false {
                let secret = try await secretsService.storeSecret(StoreSecretInput(
                    key: "telegram-bot-token",
                    value: telegramSetupDraft.normalizedBotToken,
                    description: "Telegram bot token"
                ))
                secretRefID = secret.id
            }

            telegramConfig = try await telegramService.saveConfig(TelegramConfigUpdateInput(
                enabled: telegramSetupDraft.enabled,
                allowedUserId: telegramSetupDraft.normalizedAllowedUserId,
                secretRefId: secretRefID
            ))
            telegramSetupDraft.clearSensitiveFields()
            applySnapshotToDraft(force: true)
            isPresentingTelegramSetup = false
            await refreshTelegramDetailState()
            emitInvalidation(.telegram)
        } catch let apiError as APIError {
            setActionError(apiError.userMessage, for: .telegram)
            telegramSetupDraft.clearSensitiveFields()
        } catch {
            setActionError("Telegram configuration failed.", for: .telegram)
            telegramSetupDraft.clearSensitiveFields()
        }
    }

    func applyTelegramConfig() async {
        clearActionError()
        defer { activity = nil }

        do {
            let response = try await telegramService.applyConfig()
            telegramConfig = response.snapshot
            if response.status.hasPrefix("failed") {
                setActionError(response.summary, for: .telegram)
            }
            await refreshTelegramDetailState()
            emitInvalidation(.telegram)
        } catch let apiError as APIError {
            setActionError(apiError.userMessage, for: .telegram)
        } catch {
            setActionError("Telegram apply failed.", for: .telegram)
        }
    }

    func restartDaemon() async {
        clearActionError()
        defer { activity = nil }

        do {
            let response = try await telegramService.restartDaemon()
            if response.status == "manual_required" {
                setActionError(response.summary, for: .telegram)
            }
            await refreshTelegramDetailState()
        } catch let apiError as APIError {
            setActionError(apiError.userMessage, for: .telegram)
        } catch {
            setActionError("Daemon restart request failed.", for: .telegram)
        }
    }

    func presentTelegramSetup() {
        applySnapshotToDraft(force: true)
        clearActionError()
        isPresentingTelegramSetup = true
    }
}
