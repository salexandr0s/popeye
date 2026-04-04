import Foundation
import PopeyeAPI

enum SetupProviderCardBuilder {
    static func makeCard(
        id: SetupCardID,
        connections: [ConnectionDTO],
        oauthProviders: [OAuthProviderAvailabilityDTO] = []
    ) -> SetupCard {
        let availability = matchingOAuthProvider(for: id, in: oauthProviders)

        guard let connection = matchingConnection(for: id, in: connections) else {
            return missingCard(id: id, availability: availability)
        }

        let state = providerState(for: connection)
        let summary = providerSummary(for: id, connection: connection, state: state, availability: availability)
        let guidance = providerGuidance(for: id, connection: connection, state: state, availability: availability)
        let primaryAction = providerPrimaryAction(for: id, connection: connection, state: state, availability: availability)

        return SetupCard(
            id: id,
            state: state,
            summary: summary,
            guidance: guidance,
            detailRows: detailRows(for: connection, availability: availability),
            followUpRows: [],
            followUpFootnote: nil,
            primaryAction: primaryAction,
            supplementaryActions: [],
            destination: .connections(id: connection.id)
        )
    }

    private static func missingCard(id: SetupCardID, availability: OAuthProviderAvailabilityDTO?) -> SetupCard {
        let isReady = availability?.isReady ?? true

        return SetupCard(
            id: id,
            state: .missing,
            summary: isReady ? "\(id.title) is not connected yet." : "\(id.title) cannot start setup yet.",
            guidance: isReady ? missingGuidance(for: id) : availability?.details ?? missingGuidance(for: id),
            detailRows: [
                SetupCardDetail(label: "Expected Surface", value: "Connections"),
                SetupCardDetail(label: "Provider", value: id.title),
            ] + readinessDetailRows(for: availability),
            followUpRows: [],
            followUpFootnote: nil,
            primaryAction: isReady
                ? .oauth(kind: .startSetup, providerKind: id.rawValue, connectionId: nil)
                : configureOAuthAction(for: id),
            supplementaryActions: [],
            destination: .connections(id: nil)
        )
    }

    private static func detailRows(
        for connection: ConnectionDTO,
        availability: OAuthProviderAvailabilityDTO?
    ) -> [SetupCardDetail] {
        var rows = [
            SetupCardDetail(label: "Connection", value: connection.label),
            SetupCardDetail(label: "Mode", value: connection.mode.replacingOccurrences(of: "_", with: " ").capitalized),
            SetupCardDetail(label: "Enabled", value: connection.enabled ? "Yes" : "No"),
        ]

        if let policy = connection.policy {
            rows.append(SetupCardDetail(label: "Readiness", value: policy.status.replacingOccurrences(of: "_", with: " ").capitalized))
            rows.append(SetupCardDetail(label: "Secret", value: policy.secretStatus.replacingOccurrences(of: "_", with: " ").capitalized))
        }

        if let health = connection.health {
            rows.append(SetupCardDetail(label: "Auth", value: health.authState.replacingOccurrences(of: "_", with: " ").capitalized))
            if let checkedAt = health.checkedAt {
                rows.append(SetupCardDetail(label: "Checked", value: DateFormatting.formatRelativeTime(checkedAt)))
            }
        }

        if let sync = connection.sync {
            rows.append(SetupCardDetail(label: "Sync", value: sync.status.replacingOccurrences(of: "_", with: " ").capitalized))
            if sync.lagSummary.isEmpty == false {
                rows.append(SetupCardDetail(label: "Lag", value: sync.lagSummary))
            }
        }

        rows.append(contentsOf: readinessDetailRows(for: availability))

        return rows
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

    private static func matchingOAuthProvider(
        for id: SetupCardID,
        in providers: [OAuthProviderAvailabilityDTO]
    ) -> OAuthProviderAvailabilityDTO? {
        providers.first { provider in
            switch id {
            case .github:
                provider.providerKind == "github"
            case .gmail:
                provider.providerKind == "gmail"
            case .googleCalendar:
                provider.providerKind == "google_calendar"
            case .daemon, .telegram:
                false
            }
        }
    }

    private static func providerState(for connection: ConnectionDTO) -> SetupCardState {
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

    private static func providerSummary(
        for id: SetupCardID,
        connection: ConnectionDTO,
        state: SetupCardState,
        availability: OAuthProviderAvailabilityDTO?
    ) -> String {
        if availability?.isReady == false, state != .connected {
            return "\(id.title) cannot continue OAuth setup yet."
        }

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

    private static func providerGuidance(
        for id: SetupCardID,
        connection: ConnectionDTO,
        state: SetupCardState,
        availability: OAuthProviderAvailabilityDTO?
    ) -> String {
        if availability?.isReady == false, state != .connected {
            return availability?.details ?? missingGuidance(for: id)
        }

        if let remediation = connection.health?.remediation {
            return remediation.message
        }

        switch state {
        case .connected:
            return "Open Connections for the full diagnostics and policy view."
        case .missing:
            return missingGuidance(for: id)
        case .degraded:
            if let error = connection.health?.lastError, error.isEmpty == false {
                return error
            }
            return "Check sync freshness, scopes, and connection diagnostics in the Connections view."
        case .reauthRequired:
            return "Open Connections to reauthorize the provider and confirm scopes."
        }
    }

    private static func providerPrimaryAction(
        for id: SetupCardID,
        connection: ConnectionDTO,
        state: SetupCardState,
        availability: OAuthProviderAvailabilityDTO?
    ) -> SetupCardAction? {
        if availability?.isReady == false {
            return configureOAuthAction(for: id)
        }

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

    private static func configureOAuthAction(for id: SetupCardID) -> SetupCardAction? {
        switch id {
        case .github:
            .configureOAuth(provider: .github)
        case .gmail, .googleCalendar:
            .configureOAuth(provider: .google)
        case .daemon, .telegram:
            nil
        }
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

    private static func readinessDetailRows(for availability: OAuthProviderAvailabilityDTO?) -> [SetupCardDetail] {
        guard let availability else { return [] }
        return [
            SetupCardDetail(
                label: "OAuth Readiness",
                value: availability.status.replacingOccurrences(of: "_", with: " ").capitalized
            ),
            SetupCardDetail(label: "OAuth Config", value: availability.details),
        ]
    }
}
