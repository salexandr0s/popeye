import Foundation
import Testing

@testable import PopeyeAPI

@Suite("Governance API Surface")
struct GovernanceAPITests {
    let decoder = ResponseDecoder.makeDecoder()

    @Test("Governance policy endpoints encode list and mutation paths")
    func governanceEndpoints() {
        let standingApprovals = Endpoint.standingApprovals(status: "active", domain: "github", actionKind: "write")
        let automationGrants = Endpoint.automationGrants(status: "revoked", domain: "email", actionKind: "digest")
        let revokeStanding = Endpoint.revokeStandingApproval(id: "grant-1")
        let revokeAutomation = Endpoint.revokeAutomationGrant(id: "grant-2")
        let securityPolicy = Endpoint.securityPolicy
        let vaultDetail = Endpoint.vault(id: "vault-1")

        #expect(standingApprovals.path == "/v1/policies/standing-approvals")
        #expect(standingApprovals.queryItems.contains(URLQueryItem(name: "status", value: "active")))
        #expect(standingApprovals.queryItems.contains(URLQueryItem(name: "domain", value: "github")))
        #expect(standingApprovals.queryItems.contains(URLQueryItem(name: "actionKind", value: "write")))
        #expect(Endpoint.createStandingApproval.method == .post)
        #expect(revokeStanding.path == "/v1/policies/standing-approvals/grant-1/revoke")
        #expect(revokeStanding.method == .post)
        #expect(automationGrants.path == "/v1/policies/automation-grants")
        #expect(automationGrants.queryItems.contains(URLQueryItem(name: "status", value: "revoked")))
        #expect(automationGrants.queryItems.contains(URLQueryItem(name: "domain", value: "email")))
        #expect(automationGrants.queryItems.contains(URLQueryItem(name: "actionKind", value: "digest")))
        #expect(Endpoint.createAutomationGrant.method == .post)
        #expect(revokeAutomation.path == "/v1/policies/automation-grants/grant-2/revoke")
        #expect(revokeAutomation.method == .post)
        #expect(securityPolicy.path == "/v1/security/policy")
        #expect(vaultDetail.path == "/v1/vaults/vault-1")
    }

    @Test("Decode governance policy DTOs from inline JSON")
    func decodeGovernanceDTOs() throws {
        let standingApproval = try decoder.decode(
            StandingApprovalRecordDTO.self,
            from: Data(
                """
                {
                  "id": "grant-1",
                  "scope": "external_write",
                  "domain": "github",
                  "actionKind": "write",
                  "resourceScope": "resource",
                  "resourceType": "repo",
                  "resourceId": "nb/popeye",
                  "requestedBy": "operator",
                  "workspaceId": "default",
                  "projectId": null,
                  "note": "Safe allowlist grant",
                  "expiresAt": "2026-05-01T00:00:00Z",
                  "createdBy": "macos_app",
                  "status": "active",
                  "createdAt": "2026-04-08T10:00:00Z",
                  "revokedAt": null,
                  "revokedBy": null
                }
                """.utf8)
        )
        let automationGrant = try decoder.decode(
            AutomationGrantRecordDTO.self,
            from: Data(
                """
                {
                  "id": "grant-2",
                  "scope": "external_write",
                  "domain": "email",
                  "actionKind": "digest",
                  "resourceScope": "workspace",
                  "resourceType": "mailbox",
                  "resourceId": "Inbox",
                  "requestedBy": "heartbeat",
                  "workspaceId": "default",
                  "projectId": null,
                  "note": "Nightly digest",
                  "expiresAt": null,
                  "createdBy": "macos_app",
                  "taskSources": ["heartbeat", "schedule"],
                  "status": "active",
                  "createdAt": "2026-04-08T10:00:00Z",
                  "revokedAt": null,
                  "revokedBy": null
                }
                """.utf8)
        )
        let securityPolicy = try decoder.decode(
            SecurityPolicyResponseDTO.self,
            from: Data(
                """
                {
                  "domainPolicies": [
                    {
                      "domain": "github",
                      "sensitivity": "personal",
                      "embeddingPolicy": "derived_only",
                      "contextReleasePolicy": "summary"
                    }
                  ],
                  "approvalRules": [
                    {
                      "scope": "external_write",
                      "domain": "github",
                      "riskClass": "ask",
                      "actionKinds": ["write", "send"],
                      "resourceScopes": ["resource"]
                    }
                  ],
                  "defaultRiskClass": "ask",
                  "actionDefaults": [
                    {
                      "scope": "external_write",
                      "domain": "github",
                      "actionKind": "write",
                      "riskClass": "ask",
                      "standingApprovalEligible": true,
                      "automationGrantEligible": false,
                      "reason": "GitHub writes stay operator-approved by default"
                    }
                  ]
                }
                """.utf8)
        )
        let vault = try decoder.decode(
            VaultRecordDTO.self,
            from: Data(
                """
                {
                  "id": "vault-1",
                  "domain": "finance",
                  "kind": "restricted",
                  "dbPath": "/Users/operator/Library/Application Support/Popeye/vaults/finance.db",
                  "encrypted": true,
                  "encryptionKeyRef": "keychain:finance",
                  "status": "closed",
                  "createdAt": "2026-04-01T08:00:00Z",
                  "lastAccessedAt": "2026-04-08T09:00:00Z"
                }
                """.utf8)
        )

        #expect(standingApproval.resourceId == "nb/popeye")
        #expect(automationGrant.taskSources.count == 2)
        #expect(securityPolicy.domainPolicies.first?.contextReleasePolicy == "summary")
        #expect(securityPolicy.approvalRules.first?.actionKinds == ["write", "send"])
        #expect(vault.encrypted == true)
    }
}
