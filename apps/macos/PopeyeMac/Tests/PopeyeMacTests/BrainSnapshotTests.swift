import Foundation
import Testing
@testable import PopeyeAPI
@testable import PopeyeMac

@Suite("Brain Snapshot")
struct BrainSnapshotTests {
    private let decoder = ResponseDecoder.makeDecoder()

    @Test("Brain snapshot resolves active identity, soul, and playbooks")
    func summaryFields() throws {
        let identities = try decoder.decode([IdentityRecordDTO].self, from: Data("""
        [
          {
            "id": "default",
            "workspaceId": "default",
            "path": "identities/default.md",
            "exists": true,
            "selected": false
          },
          {
            "id": "reviewer",
            "workspaceId": "default",
            "path": "identities/reviewer.md",
            "exists": true,
            "selected": true
          }
        ]
        """.utf8))

        let defaultIdentity = try decoder.decode(WorkspaceIdentityDefaultDTO.self, from: Data("""
        {
          "workspaceId": "default",
          "identityId": "reviewer",
          "updatedAt": "2026-03-26T09:00:00Z"
        }
        """.utf8))

        let preview = try decoder.decode(InstructionPreviewDTO.self, from: Data("""
        {
          "id": "bundle-001",
          "sources": [
            {
              "precedence": 3,
              "type": "identity",
              "path": "identities/reviewer.md",
              "inlineId": null,
              "contentHash": "hash-1",
              "content": "# Reviewer identity"
            },
            {
              "precedence": 4,
              "type": "soul",
              "path": "SOUL.md",
              "inlineId": null,
              "contentHash": "hash-2",
              "content": "# Soul overlay"
            }
          ],
          "playbooks": [
            {
              "id": "triage",
              "title": "Inbox triage",
              "scope": "workspace",
              "revisionHash": "rev-1"
            }
          ],
          "compiledText": "bundle text",
          "bundleHash": "bundlehash",
          "warnings": [],
          "createdAt": "2026-03-26T09:00:00Z"
        }
        """.utf8))

        let snapshot = BrainSnapshot(
            identities: identities,
            defaultIdentity: defaultIdentity,
            preview: preview
        )

        #expect(snapshot.activeIdentityID == "reviewer")
        #expect(snapshot.activeIdentityRecord?.path == "identities/reviewer.md")
        #expect(snapshot.soulSource?.path == "SOUL.md")
        #expect(snapshot.playbooks.count == 1)
        #expect(snapshot.sourceGroups.map(\.type) == ["identity", "soul"])
    }
}
