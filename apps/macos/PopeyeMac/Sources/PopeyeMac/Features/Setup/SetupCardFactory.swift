import Foundation
import PopeyeAPI

enum SetupCardFactory {
    static func makeCards(
        session: SetupSessionSnapshot,
        connections: [ConnectionDTO],
        relayCheckpoint: TelegramRelayCheckpointDTO?,
        uncertainDeliveries: [TelegramDeliveryDTO],
        telegramConfig: TelegramConfigSnapshotDTO?,
        mutationReceipts: [MutationReceiptDTO]
    ) -> [SetupCard] {
        [
            makeDaemonCard(session: session),
            makeProviderCard(id: .github, connections: connections),
            makeProviderCard(id: .gmail, connections: connections),
            makeProviderCard(id: .googleCalendar, connections: connections),
            makeTelegramCard(
                relayCheckpoint: relayCheckpoint,
                uncertainDeliveries: uncertainDeliveries,
                configSnapshot: telegramConfig,
                mutationReceipts: mutationReceipts
            ),
        ]
    }

    private static func makeDaemonCard(session: SetupSessionSnapshot) -> SetupCard {
        let state: SetupCardState
        let summary: String
        let guidance: String
        let sessionLabel: String

        switch session.connectionState {
        case .connected:
            state = .connected
            summary = "Connected to the loopback control API."
            guidance = session.sseConnected
                ? "Live updates are active for this app session."
                : "Connected without live updates. Refresh still uses the control API."
            sessionLabel = "Connected"
        case .connecting:
            state = .degraded
            summary = "Connecting to the daemon."
            guidance = "Wait for health checks to complete before reviewing provider setup."
            sessionLabel = "Connecting"
        case .disconnected:
            state = .missing
            summary = "Not connected to the daemon."
            guidance = "Reconnect from the welcome screen to load setup and brain data."
            sessionLabel = "Disconnected"
        case .failed(let error):
            state = .degraded
            summary = "The app could not validate the daemon session."
            guidance = error.userMessage
            sessionLabel = "Failed"
        }

        return SetupCard(
            id: .daemon,
            state: state,
            summary: summary,
            guidance: guidance,
            detailRows: [
                SetupCardDetail(label: "Base URL", value: session.baseURL),
                SetupCardDetail(label: "Session", value: sessionLabel),
                SetupCardDetail(label: "Live Updates", value: session.sseConnected ? "Connected" : "Not connected"),
            ],
            followUpRows: [],
            followUpFootnote: nil,
            primaryAction: nil,
            supplementaryActions: [],
            destination: nil
        )
    }

    private static func makeProviderCard(id: SetupCardID, connections: [ConnectionDTO]) -> SetupCard {
        guard let connection = matchingConnection(for: id, in: connections) else {
            return SetupCard(
                id: id,
                state: .missing,
                summary: "\(id.title) is not connected yet.",
                guidance: missingGuidance(for: id),
                detailRows: [
                    SetupCardDetail(label: "Expected Surface", value: "Connections"),
                    SetupCardDetail(label: "Provider", value: id.title),
                ],
                followUpRows: [],
                followUpFootnote: nil,
                primaryAction: .oauth(kind: .startSetup, providerKind: id.rawValue, connectionId: nil),
                supplementaryActions: [],
                destination: .connections(id: nil)
            )
        }

        let state = state(for: connection)
        let summary = providerSummary(for: id, connection: connection, state: state)
        let guidance = providerGuidance(for: id, connection: connection, state: state)
        let primaryAction = providerPrimaryAction(for: id, connection: connection, state: state)

        var detailRows = [
            SetupCardDetail(label: "Connection", value: connection.label),
            SetupCardDetail(label: "Mode", value: connection.mode.replacingOccurrences(of: "_", with: " ").capitalized),
            SetupCardDetail(label: "Enabled", value: connection.enabled ? "Yes" : "No"),
        ]

        if let policy = connection.policy {
            detailRows.append(SetupCardDetail(label: "Readiness", value: policy.status.replacingOccurrences(of: "_", with: " ").capitalized))
            detailRows.append(SetupCardDetail(label: "Secret", value: policy.secretStatus.replacingOccurrences(of: "_", with: " ").capitalized))
        }

        if let health = connection.health {
            detailRows.append(SetupCardDetail(label: "Auth", value: health.authState.replacingOccurrences(of: "_", with: " ").capitalized))
            if let checkedAt = health.checkedAt {
                detailRows.append(SetupCardDetail(label: "Checked", value: DateFormatting.formatRelativeTime(checkedAt)))
            }
        }

        if let sync = connection.sync {
            detailRows.append(SetupCardDetail(label: "Sync", value: sync.status.replacingOccurrences(of: "_", with: " ").capitalized))
            if !sync.lagSummary.isEmpty {
                detailRows.append(SetupCardDetail(label: "Lag", value: sync.lagSummary))
            }
        }

        return SetupCard(
            id: id,
            state: state,
            summary: summary,
            guidance: guidance,
            detailRows: detailRows,
            followUpRows: [],
            followUpFootnote: nil,
            primaryAction: primaryAction,
            supplementaryActions: [],
            destination: .connections(id: connection.id)
        )
    }

    private static func makeTelegramCard(
        relayCheckpoint: TelegramRelayCheckpointDTO?,
        uncertainDeliveries: [TelegramDeliveryDTO],
        configSnapshot: TelegramConfigSnapshotDTO?,
        mutationReceipts: [MutationReceiptDTO]
    ) -> SetupCard {
        let relevantReceipts = mutationReceipts.filter { $0.component == "telegram" || $0.kind == "daemon_restart" }
        let latestReceipt = relevantReceipts.first

        let state: SetupCardState
        let summary: String
        let guidance: String

        if !uncertainDeliveries.isEmpty {
            state = .degraded
            summary = "Telegram has \(uncertainDeliveries.count) delivery issue\(uncertainDeliveries.count == 1 ? "" : "s") to review."
            guidance = "Open Telegram operations to resolve ambiguous sends and confirm bridge health."
        } else if relayCheckpoint != nil {
            state = .connected
            summary = "Telegram bridge activity is visible."
            guidance = configSnapshot?.staleComparedToApplied == true
                ? "Relay activity exists, but newer saved settings still need to be applied."
                : "Relay checkpoints are updating and no uncertain deliveries need attention."
        } else if let configSnapshot {
            if configSnapshot.persisted.enabled {
                if configSnapshot.secretAvailability == "missing" {
                    state = .missing
                    summary = "Telegram is enabled, but the configured bot token is unavailable."
                    guidance = "Store or restore the Telegram bot token before the bridge can start."
                } else if configSnapshot.staleComparedToApplied {
                    state = .degraded
                    summary = "Telegram settings are saved but not applied yet."
                    guidance = configSnapshot.restartSupported
                        ? "Apply the saved config now, or restart the daemon to pick it up."
                        : "Apply the saved config now. If the bridge stays inactive, restart the daemon manually."
                } else {
                    state = .degraded
                    summary = "Telegram is configured, but the bridge is not active yet."
                    guidance = configSnapshot.restartSupported
                        ? "If relay activity still does not appear, apply again or restart the daemon."
                        : "This daemon may need a manual restart before Telegram becomes active."
                }
            } else if configSnapshot.persisted.allowedUserId != nil || configSnapshot.persisted.secretRefId != nil {
                state = .missing
                summary = "Telegram settings exist, but the bridge is disabled."
                guidance = "Enable Telegram and apply the saved config when you're ready."
            } else {
                state = .missing
                summary = "Telegram is not configured yet."
                guidance = "Store a bot token, set the allowed user ID, and enable the bridge."
            }
        } else {
            state = .missing
            summary = "Telegram setup data is unavailable."
            guidance = "Refresh the app after the daemon is connected to inspect Telegram setup."
        }

        var detailRows = [
            SetupCardDetail(label: "Uncertain Deliveries", value: "\(uncertainDeliveries.count)"),
        ]

        if let configSnapshot {
            detailRows.append(contentsOf: [
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
            detailRows.append(contentsOf: [
                SetupCardDetail(label: "Relay", value: relayCheckpoint.relayKey),
                SetupCardDetail(label: "Checkpoint", value: String(relayCheckpoint.lastAcknowledgedUpdateId)),
                SetupCardDetail(label: "Updated", value: DateFormatting.formatRelativeTime(relayCheckpoint.updatedAt)),
            ])
        }

        if let latestReceipt {
            detailRows.append(contentsOf: [
                SetupCardDetail(label: "Latest Change", value: latestReceipt.summary),
                SetupCardDetail(label: "Latest Status", value: latestReceipt.status.replacingOccurrences(of: "_", with: " ").capitalized),
                SetupCardDetail(label: "Changed", value: DateFormatting.formatRelativeTime(latestReceipt.createdAt)),
            ])
        }

        let followUpRows = telegramFollowUpRows(configSnapshot: configSnapshot)
        let footnote = telegramFootnote(configSnapshot: configSnapshot)
        var supplementaryActions: [SetupCardAction] = []
        if let configSnapshot, configSnapshot.staleComparedToApplied {
            supplementaryActions.append(.telegramApply)
        }
        if let configSnapshot, configSnapshot.restartSupported, (state != .connected || configSnapshot.staleComparedToApplied) {
            supplementaryActions.append(.daemonRestart)
        }

        return SetupCard(
            id: .telegram,
            state: state,
            summary: summary,
            guidance: guidance,
            detailRows: detailRows,
            followUpRows: followUpRows,
            followUpFootnote: footnote,
            primaryAction: .telegramConfigure,
            supplementaryActions: supplementaryActions,
            destination: .telegram
        )
    }

    private static func matchingConnection(for id: SetupCardID, in connections: [ConnectionDTO]) -> ConnectionDTO? {
        connections.first { connection in
            switch id {
            case .github:
                connection.providerKind == "github" || connection.domain == "github"
            case .gmail:
                connection.providerKind == "gmail" || connection.domain == "email"
            case .googleCalendar:
                connection.providerKind == "google_calendar" || connection.domain == "calendar"
            case .daemon, .telegram:
                false
            }
        }
    }

    private static func state(for connection: ConnectionDTO) -> SetupCardState {
        let authState = connection.health?.authState ?? "not_required"
        let healthStatus = connection.health?.status ?? "unknown"
        let policyStatus = connection.policy?.status ?? "ready"
        let secretStatus = connection.policy?.secretStatus ?? "not_required"
        let syncStatus = connection.sync?.status ?? "idle"

        if ["reauth_required"].contains(healthStatus) || ["expired", "revoked", "invalid_scopes"].contains(authState) {
            return .reauthRequired
        }

        if connection.enabled == false || policyStatus == "incomplete" || ["missing", "stale"].contains(secretStatus) || ["missing", "stale"].contains(authState) {
            return .missing
        }

        if ["degraded", "error"].contains(healthStatus) || ["partial", "failed"].contains(syncStatus) {
            return .degraded
        }

        return .connected
    }

    private static func providerSummary(for id: SetupCardID, connection: ConnectionDTO, state: SetupCardState) -> String {
        switch state {
        case .connected:
            if let sync = connection.sync, sync.status == "success" {
                return "\(id.title) is connected and syncing normally."
            }
            return "\(id.title) is connected."
        case .missing:
            if connection.enabled == false {
                return "\(id.title) is present but disabled."
            }
            return "\(id.title) setup is incomplete."
        case .degraded:
            return "\(id.title) needs attention."
        case .reauthRequired:
            return "\(id.title) needs reauthorization."
        }
    }

    private static func providerGuidance(for id: SetupCardID, connection: ConnectionDTO, state: SetupCardState) -> String {
        if let remediation = connection.health?.remediation {
            return remediation.message
        }

        switch state {
        case .connected:
            return "Open Connections for the full diagnostics and policy view."
        case .missing:
            return missingGuidance(for: id)
        case .degraded:
            if let error = connection.health?.lastError, !error.isEmpty {
                return error
            }
            return "Check sync freshness, scopes, and connection diagnostics in the Connections view."
        case .reauthRequired:
            return "Open Connections to reauthorize the provider and confirm scopes."
        }
    }

    private static func providerPrimaryAction(for id: SetupCardID, connection: ConnectionDTO, state: SetupCardState) -> SetupCardAction? {
        guard connection.enabled else { return nil }

        let remediation = connection.health?.remediation?.action

        if state == .reauthRequired || remediation == "reauthorize" || remediation == "scope_fix" {
            return .oauth(kind: .reauthorize, providerKind: id.rawValue, connectionId: connection.id)
        }

        if remediation == "reconnect" || remediation == "secret_fix" || state == .missing || state == .degraded {
            return .oauth(kind: .reconnect, providerKind: id.rawValue, connectionId: connection.id)
        }

        return nil
    }

    private static func missingGuidance(for id: SetupCardID) -> String {
        switch id {
        case .github:
            "Connect GitHub from the Connections surface so repositories and notifications can sync."
        case .gmail:
            "Connect Gmail from the Connections surface so mail data can sync into Popeye."
        case .googleCalendar:
            "Connect Google Calendar from the Connections surface so schedules and events are visible."
        case .daemon:
            "Reconnect to the local daemon to continue setup."
        case .telegram:
            "Open Telegram operations after the bridge is configured to confirm relay health."
        }
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
