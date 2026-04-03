import Foundation
import PopeyeAPI

enum SetupTelegramCardBuilder {
    static func makeCard(context: SetupCardBuildContext) -> SetupCard {
        let latestReceipt = latestTelegramReceipt(from: context.mutationReceipts)
        let content = cardContent(
            relayCheckpoint: context.relayCheckpoint,
            uncertainDeliveries: context.uncertainDeliveries,
            configSnapshot: context.telegramConfig
        )

        return SetupCard(
            id: .telegram,
            state: content.state,
            summary: content.summary,
            guidance: content.guidance,
            detailRows: detailRows(
                relayCheckpoint: context.relayCheckpoint,
                uncertainDeliveries: context.uncertainDeliveries,
                configSnapshot: context.telegramConfig,
                latestReceipt: latestReceipt
            ),
            followUpRows: telegramFollowUpRows(configSnapshot: context.telegramConfig),
            followUpFootnote: telegramFootnote(configSnapshot: context.telegramConfig),
            primaryAction: .telegramConfigure,
            supplementaryActions: supplementaryActions(configSnapshot: context.telegramConfig, state: content.state),
            destination: .telegram
        )
    }

    private static func latestTelegramReceipt(from mutationReceipts: [MutationReceiptDTO]) -> MutationReceiptDTO? {
        mutationReceipts
            .filter { $0.component == "telegram" || $0.kind == "daemon_restart" }
            .first
    }

    private static func cardContent(
        relayCheckpoint: TelegramRelayCheckpointDTO?,
        uncertainDeliveries: [TelegramDeliveryDTO],
        configSnapshot: TelegramConfigSnapshotDTO?
    ) -> (state: SetupCardState, summary: String, guidance: String) {
        if uncertainDeliveries.isEmpty == false {
            return (
                .degraded,
                "Telegram has \(uncertainDeliveries.count) delivery issue\(uncertainDeliveries.count == 1 ? "" : "s") to review.",
                "Open Telegram operations to resolve ambiguous sends and confirm bridge health."
            )
        }

        if relayCheckpoint != nil {
            return (
                .connected,
                "Telegram bridge activity is visible.",
                configSnapshot?.staleComparedToApplied == true
                    ? "Relay activity exists, but newer saved settings still need to be applied."
                    : "Relay checkpoints are updating and no uncertain deliveries need attention."
            )
        }

        guard let configSnapshot else {
            return (
                .missing,
                "Telegram setup data is unavailable.",
                "Refresh the app after the daemon is connected to inspect Telegram setup."
            )
        }

        if configSnapshot.persisted.enabled {
            if configSnapshot.secretAvailability == "missing" {
                return (
                    .missing,
                    "Telegram is enabled, but the configured bot token is unavailable.",
                    "Store or restore the Telegram bot token before the bridge can start."
                )
            }

            if configSnapshot.staleComparedToApplied {
                return (
                    .degraded,
                    "Telegram settings are saved but not applied yet.",
                    configSnapshot.restartSupported
                        ? "Apply the saved config now, or restart the daemon to pick it up."
                        : "Apply the saved config now. If the bridge stays inactive, restart the daemon manually."
                )
            }

            return (
                .degraded,
                "Telegram is configured, but the bridge is not active yet.",
                configSnapshot.restartSupported
                    ? "If relay activity still does not appear, apply again or restart the daemon."
                    : "This daemon may need a manual restart before Telegram becomes active."
            )
        }

        if configSnapshot.persisted.allowedUserId != nil || configSnapshot.persisted.secretRefId != nil {
            return (
                .missing,
                "Telegram settings exist, but the bridge is disabled.",
                "Enable Telegram and apply the saved config when you're ready."
            )
        }

        return (
            .missing,
            "Telegram is not configured yet.",
            "Store a bot token, set the allowed user ID, and enable the bridge."
        )
    }

    private static func detailRows(
        relayCheckpoint: TelegramRelayCheckpointDTO?,
        uncertainDeliveries: [TelegramDeliveryDTO],
        configSnapshot: TelegramConfigSnapshotDTO?,
        latestReceipt: MutationReceiptDTO?
    ) -> [SetupCardDetail] {
        var rows = [
            SetupCardDetail(label: "Uncertain Deliveries", value: "\(uncertainDeliveries.count)"),
        ]

        if let configSnapshot {
            rows.append(contentsOf: [
                SetupCardDetail(label: "Persisted Enabled", value: configSnapshot.persisted.enabled ? "Yes" : "No"),
                SetupCardDetail(label: "Applied Enabled", value: configSnapshot.applied.enabled ? "Yes" : "No"),
                SetupCardDetail(label: "Allowed User ID", value: configSnapshot.persisted.allowedUserId ?? "Not set"),
                SetupCardDetail(label: "Secret Ref", value: configSnapshot.persisted.secretRefId ?? "Not set"),
                SetupCardDetail(label: "Secret Availability", value: configSnapshot.secretAvailability.replacingOccurrences(of: "_", with: " ").capitalized),
                SetupCardDetail(label: "Target Workspace", value: configSnapshot.effectiveWorkspaceId),
                SetupCardDetail(label: "Restart Mode", value: configSnapshot.managementMode.capitalized),
            ])
        }

        if let relayCheckpoint {
            rows.append(contentsOf: [
                SetupCardDetail(label: "Relay", value: relayCheckpoint.relayKey),
                SetupCardDetail(label: "Checkpoint", value: String(relayCheckpoint.lastAcknowledgedUpdateId)),
                SetupCardDetail(label: "Updated", value: DateFormatting.formatRelativeTime(relayCheckpoint.updatedAt)),
            ])
        }

        if let latestReceipt {
            rows.append(contentsOf: [
                SetupCardDetail(label: "Latest Change", value: latestReceipt.summary),
                SetupCardDetail(label: "Latest Status", value: latestReceipt.status.replacingOccurrences(of: "_", with: " ").capitalized),
                SetupCardDetail(label: "Changed", value: DateFormatting.formatRelativeTime(latestReceipt.createdAt)),
            ])
        }

        return rows
    }

    private static func supplementaryActions(
        configSnapshot: TelegramConfigSnapshotDTO?,
        state: SetupCardState
    ) -> [SetupCardAction] {
        guard let configSnapshot else { return [] }

        var actions: [SetupCardAction] = []
        if configSnapshot.staleComparedToApplied {
            actions.append(.telegramApply)
        }
        if configSnapshot.restartSupported, (state != .connected || configSnapshot.staleComparedToApplied) {
            actions.append(.daemonRestart)
        }
        return actions
    }

    private static func telegramFollowUpRows(configSnapshot: TelegramConfigSnapshotDTO?) -> [SetupCardDetail] {
        guard let configSnapshot else {
            return []
        }

        return [
            SetupCardDetail(label: "telegram.enabled", value: configSnapshot.persisted.enabled ? "true" : "false"),
            SetupCardDetail(label: "telegram.allowedUserId", value: configSnapshot.persisted.allowedUserId ?? "<required-user-id>"),
            SetupCardDetail(label: "telegram.secretRefId", value: configSnapshot.persisted.secretRefId ?? "<stored-secret-ref>"),
        ]
    }

    private static func telegramFootnote(configSnapshot: TelegramConfigSnapshotDTO?) -> String? {
        guard let configSnapshot else { return nil }
        if configSnapshot.managementMode == "manual" && configSnapshot.persisted.enabled {
            return "This daemon is not launchd-managed. If Apply does not activate Telegram, restart the daemon manually."
        }
        if configSnapshot.warnings.isEmpty == false {
            return configSnapshot.warnings.joined(separator: " ")
        }
        return nil
    }
}
