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
}
