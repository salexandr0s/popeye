import Foundation
import Testing
@testable import PopeyeAPI
@testable import PopeyeMac

@Suite("Setup Card Factory")
struct SetupCardFactoryTests {
    private let decoder = ResponseDecoder.makeDecoder()

    @Test("Setup cards distinguish connected, degraded, reauth-required, and missing states")
    func setupCardStates() throws {
        let connections = try decoder.decode([ConnectionDTO].self, from: Data("""
        [
          {
            "id": "conn-gh-001",
            "domain": "github",
            "provider_kind": "github",
            "label": "GitHub",
            "mode": "read_write",
            "enabled": true,
            "last_sync_at": "2026-03-25T08:00:00Z",
            "last_sync_status": "success",
            "policy": {
              "status": "ready",
              "secret_status": "configured",
              "mutating_requires_approval": true
            },
            "health": {
              "status": "healthy",
              "auth_state": "configured",
              "checked_at": "2026-03-25T08:00:00Z",
              "last_error": null,
              "remediation": null
            },
            "sync": {
              "last_attempt_at": "2026-03-25T08:00:00Z",
              "last_success_at": "2026-03-25T08:00:00Z",
              "status": "success",
              "lag_summary": "0s"
            },
            "created_at": "2026-03-20T08:00:00Z",
            "updated_at": "2026-03-25T08:00:00Z"
          },
          {
            "id": "conn-gmail-001",
            "domain": "email",
            "provider_kind": "gmail",
            "label": "Gmail",
            "mode": "read_only",
            "enabled": true,
            "last_sync_at": "2026-03-25T08:00:00Z",
            "last_sync_status": "failed",
            "policy": {
              "status": "ready",
              "secret_status": "configured",
              "mutating_requires_approval": false
            },
            "health": {
              "status": "degraded",
              "auth_state": "configured",
              "checked_at": "2026-03-25T08:00:00Z",
              "last_error": "Mailbox sync failed",
              "remediation": null
            },
            "sync": {
              "last_attempt_at": "2026-03-25T08:00:00Z",
              "last_success_at": "2026-03-24T08:00:00Z",
              "status": "failed",
              "lag_summary": "24h"
            },
            "created_at": "2026-03-20T08:00:00Z",
            "updated_at": "2026-03-25T08:00:00Z"
          },
          {
            "id": "conn-cal-001",
            "domain": "calendar",
            "provider_kind": "google_calendar",
            "label": "Calendar",
            "mode": "read_write",
            "enabled": true,
            "last_sync_at": "2026-03-25T08:00:00Z",
            "last_sync_status": "failed",
            "policy": {
              "status": "ready",
              "secret_status": "configured",
              "mutating_requires_approval": false
            },
            "health": {
              "status": "reauth_required",
              "auth_state": "revoked",
              "checked_at": "2026-03-25T08:00:00Z",
              "last_error": "Refresh token revoked",
              "remediation": {
                "action": "reauthorize",
                "message": "Reconnect Google Calendar",
                "updated_at": "2026-03-25T08:00:00Z"
              }
            },
            "sync": {
              "last_attempt_at": "2026-03-25T08:00:00Z",
              "last_success_at": "2026-03-24T08:00:00Z",
              "status": "failed",
              "lag_summary": "24h"
            },
            "created_at": "2026-03-20T08:00:00Z",
            "updated_at": "2026-03-25T08:00:00Z"
          }
        ]
        """.utf8))

        let cards = SetupCardFactory.makeCards(
            session: SetupSessionSnapshot(connectionState: .connected, baseURL: "http://127.0.0.1:3210", sseConnected: true),
            connections: connections,
            relayCheckpoint: nil,
            uncertainDeliveries: [],
            telegramConfig: nil,
            mutationReceipts: []
        )

        #expect(cards.first(where: { $0.id == .daemon })?.state == .connected)
        #expect(cards.first(where: { $0.id == .github })?.state == .connected)
        #expect(cards.first(where: { $0.id == .github })?.primaryAction == nil)
        let gmail = try #require(cards.first(where: { $0.id == .gmail }))
        #expect(gmail.state == .degraded)
        #expect(gmail.primaryAction == .oauth(kind: .reconnect, providerKind: "gmail", connectionId: "conn-gmail-001"))
        let calendar = try #require(cards.first(where: { $0.id == .googleCalendar }))
        #expect(calendar.state == .reauthRequired)
        #expect(calendar.primaryAction == .oauth(kind: .reauthorize, providerKind: "google_calendar", connectionId: "conn-cal-001"))
        let telegram = try #require(cards.first(where: { $0.id == .telegram }))
        #expect(telegram.state == .missing)
        #expect(telegram.primaryAction == .telegramConfigure)
        #expect(telegram.supplementaryActions.isEmpty)
    }

    @Test("Telegram setup card shows saved config truth, apply, and restart actions")
    func telegramActionDefaults() throws {
        let receipt = MutationReceiptDTO(
            id: "mut-telegram-001",
            kind: "telegram_config_update",
            component: "telegram",
            status: "succeeded",
            summary: "Saved Telegram config: enabled, allowedUserId, secretRefId",
            details: "details",
            actorRole: "operator",
            workspaceId: nil,
            usage: ReceiptUsageDTO(provider: "control-plane", model: "mutation", tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0),
            metadata: [:],
            createdAt: "2026-03-31T09:05:00Z"
        )
        let telegramConfig = TelegramConfigSnapshotDTO(
            persisted: TelegramConfigRecordDTO(enabled: true, allowedUserId: "5315323298", secretRefId: "secret-telegram-bot"),
            applied: TelegramConfigRecordDTO(enabled: false, allowedUserId: nil, secretRefId: nil),
            effectiveWorkspaceId: "default",
            secretAvailability: "available",
            staleComparedToApplied: true,
            warnings: ["Saved Telegram settings differ from the daemon-applied settings. Apply or restart the daemon to use the latest config."],
            managementMode: "launchd",
            restartSupported: true
        )

        let cards = SetupCardFactory.makeCards(
            session: SetupSessionSnapshot(connectionState: .connected, baseURL: "http://127.0.0.1:3210", sseConnected: true),
            connections: [],
            relayCheckpoint: nil,
            uncertainDeliveries: [],
            telegramConfig: telegramConfig,
            mutationReceipts: [receipt]
        )

        let github = try #require(cards.first(where: { $0.id == .github }))
        #expect(github.primaryAction == .oauth(kind: .startSetup, providerKind: "github", connectionId: nil))

        let telegram = try #require(cards.first(where: { $0.id == .telegram }))
        #expect(telegram.state == .degraded)
        #expect(telegram.primaryAction == .telegramConfigure)
        #expect(telegram.supplementaryActions.contains(.telegramApply))
        #expect(telegram.supplementaryActions.contains(.daemonRestart))
        #expect(telegram.followUpRows.contains(SetupCardDetail(label: "telegram.enabled", value: "true")))
        #expect(telegram.followUpRows.contains(SetupCardDetail(label: "telegram.allowedUserId", value: "5315323298")))
        #expect(telegram.followUpRows.contains(SetupCardDetail(label: "telegram.secretRefId", value: "secret-telegram-bot")))
        #expect(telegram.detailRows.contains(where: { $0.label == "Latest Change" && $0.value.contains("Saved Telegram config") }))
    }

    @Test("Disabled providers stay missing and do not offer reconnect actions")
    func disabledProviderDoesNotOfferReconnect() throws {
        let connection = Self.makeConnection(
            id: "conn-gh-disabled",
            domain: "github",
            providerKind: "github",
            enabled: false
        )

        let cards = SetupCardFactory.makeCards(
            session: SetupSessionSnapshot(connectionState: .connected, baseURL: "http://127.0.0.1:3210", sseConnected: true),
            connections: [connection],
            relayCheckpoint: nil,
            uncertainDeliveries: [],
            telegramConfig: nil,
            mutationReceipts: []
        )

        let github = try #require(cards.first(where: { $0.id == .github }))
        #expect(github.state == .missing)
        #expect(github.primaryAction == nil)
        #expect(github.summary == "GitHub is present but disabled.")
        #expect(github.destination == .connections(id: "conn-gh-disabled"))
    }

    @Test("Missing OAuth config suppresses setup and reauth actions")
    func missingOAuthConfigSuppressesActions() throws {
        let calendarConnection = Self.makeConnection(
            id: "conn-cal-reauth",
            domain: "calendar",
            providerKind: "google_calendar",
            enabled: true
        ).withHealth(
            ConnectionHealthDTO(
                status: "reauth_required",
                authState: "revoked",
                checkedAt: nil,
                lastError: "Refresh token revoked",
                remediation: ConnectionRemediationDTO(
                    action: "reauthorize",
                    message: "Reconnect Google Calendar",
                    updatedAt: "2026-03-25T08:00:00Z"
                )
            )
        )

        let cards = SetupCardFactory.makeCards(
            session: SetupSessionSnapshot(connectionState: .connected, baseURL: "http://127.0.0.1:3210", sseConnected: true),
            connections: [calendarConnection],
            oauthProviders: [
                OAuthProviderAvailabilityDTO(
                    providerKind: "gmail",
                    domain: "email",
                    status: "missing_client_credentials",
                    details: "Google OAuth is not configured. Add providerAuth.google.clientId and save the Google OAuth client secret in Popeye so providerAuth.google.clientSecretRefId points to an available secret."
                ),
                OAuthProviderAvailabilityDTO(
                    providerKind: "google_calendar",
                    domain: "calendar",
                    status: "missing_client_credentials",
                    details: "Google OAuth is not configured. Add providerAuth.google.clientId and save the Google OAuth client secret in Popeye so providerAuth.google.clientSecretRefId points to an available secret."
                ),
            ],
            relayCheckpoint: nil,
            uncertainDeliveries: [],
            telegramConfig: nil,
            mutationReceipts: []
        )

        let gmail = try #require(cards.first(where: { $0.id == .gmail }))
        #expect(gmail.primaryAction == .configureOAuth(provider: .google))
        #expect(gmail.destination == .connections(id: nil))
        #expect(gmail.guidance.contains("providerAuth.google.clientId"))

        let calendar = try #require(cards.first(where: { $0.id == .googleCalendar }))
        #expect(calendar.state == .reauthRequired)
        #expect(calendar.primaryAction == .configureOAuth(provider: .google))
        #expect(calendar.guidance.contains("providerAuth.google.clientSecretRefId"))
        #expect(calendar.detailRows.contains(where: { $0.label == "OAuth Readiness" && $0.value == "Missing Client Credentials" }))
    }

    @Test("Telegram manual restart footnote is shown for enabled manual setups")
    func telegramManualFootnote() throws {
        let telegramConfig = Self.makeTelegramSnapshot(
            persistedEnabled: true,
            appliedEnabled: false,
            allowedUserId: "5315323298",
            secretRefId: "secret-telegram-bot",
            secretAvailability: "available",
            staleComparedToApplied: false,
            managementMode: "manual",
            restartSupported: false
        )

        let cards = SetupCardFactory.makeCards(
            session: SetupSessionSnapshot(connectionState: .connected, baseURL: "http://127.0.0.1:3210", sseConnected: true),
            connections: [],
            relayCheckpoint: nil,
            uncertainDeliveries: [],
            telegramConfig: telegramConfig,
            mutationReceipts: []
        )

        let telegram = try #require(cards.first(where: { $0.id == .telegram }))
        #expect(telegram.followUpFootnote == "This daemon is not launchd-managed. If Apply does not activate Telegram, restart the daemon manually.")
        #expect(telegram.supplementaryActions.isEmpty)
    }

    private static func makeConnection(
        id: String,
        domain: String,
        providerKind: String,
        enabled: Bool
    ) -> ConnectionDTO {
        ConnectionDTO(
            id: id,
            domain: domain,
            providerKind: providerKind,
            label: providerKind.capitalized,
            mode: "read_only",
            enabled: enabled,
            lastSyncAt: nil,
            lastSyncStatus: nil,
            policy: ConnectionPolicyDTO(status: "ready", secretStatus: "configured", mutatingRequiresApproval: false),
            health: ConnectionHealthDTO(status: "healthy", authState: "configured", checkedAt: nil, lastError: nil, remediation: nil),
            sync: ConnectionSyncDTO(lastAttemptAt: nil, lastSuccessAt: nil, status: "success", lagSummary: ""),
            createdAt: "2026-03-20T08:00:00Z",
            updatedAt: "2026-03-25T08:00:00Z"
        )
    }

    private static func makeTelegramSnapshot(
        persistedEnabled: Bool,
        appliedEnabled: Bool,
        allowedUserId: String?,
        secretRefId: String?,
        secretAvailability: String,
        staleComparedToApplied: Bool,
        managementMode: String,
        restartSupported: Bool
    ) -> TelegramConfigSnapshotDTO {
        TelegramConfigSnapshotDTO(
            persisted: TelegramConfigRecordDTO(
                enabled: persistedEnabled,
                allowedUserId: allowedUserId,
                secretRefId: secretRefId
            ),
            applied: TelegramConfigRecordDTO(
                enabled: appliedEnabled,
                allowedUserId: appliedEnabled ? allowedUserId : nil,
                secretRefId: appliedEnabled ? secretRefId : nil
            ),
            effectiveWorkspaceId: "default",
            secretAvailability: secretAvailability,
            staleComparedToApplied: staleComparedToApplied,
            warnings: [],
            managementMode: managementMode,
            restartSupported: restartSupported
        )
    }
}

private extension ConnectionDTO {
    func withHealth(_ health: ConnectionHealthDTO) -> ConnectionDTO {
        ConnectionDTO(
            id: id,
            domain: domain,
            providerKind: providerKind,
            label: label,
            mode: mode,
            enabled: enabled,
            lastSyncAt: lastSyncAt,
            lastSyncStatus: lastSyncStatus,
            policy: policy,
            health: health,
            sync: sync,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}
