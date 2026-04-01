import Foundation
import Testing
@testable import PopeyeAPI
@testable import PopeyeMac

@Suite("Memory Day Grouper")
struct MemoryDayGrouperTests {
    private let decoder = ResponseDecoder.makeDecoder()

    @Test("Memory day grouping prefers source timestamps and sorts newest first")
    func dailyGrouping() throws {
        let memories = try decoder.decode([MemoryRecordDTO].self, from: Data("""
        [
          {
            "id": "mem-1",
            "description": "Latest source timestamp",
            "classification": "embeddable",
            "sourceType": "receipt",
            "content": "One",
            "confidence": 0.9,
            "scope": "workspace",
            "workspaceId": "default",
            "projectId": null,
            "sourceRunId": "run-1",
            "sourceTimestamp": "2026-03-28T15:00:00Z",
            "memoryType": "semantic",
            "dedupKey": null,
            "lastReinforcedAt": null,
            "archivedAt": null,
            "createdAt": "2026-03-20T09:00:00Z",
            "durable": false,
            "domain": "coding",
            "contextReleasePolicy": "full"
          },
          {
            "id": "mem-2",
            "description": "Same source day",
            "classification": "embeddable",
            "sourceType": "receipt",
            "content": "Two",
            "confidence": 0.7,
            "scope": "workspace",
            "workspaceId": "default",
            "projectId": null,
            "sourceRunId": "run-2",
            "sourceTimestamp": "2026-03-28T09:00:00Z",
            "memoryType": "episodic",
            "dedupKey": null,
            "lastReinforcedAt": null,
            "archivedAt": null,
            "createdAt": "2026-03-28T09:00:00Z",
            "durable": false,
            "domain": "coding",
            "contextReleasePolicy": "full"
          },
          {
            "id": "mem-3",
            "description": "Previous day from createdAt",
            "classification": "embeddable",
            "sourceType": "receipt",
            "content": "Three",
            "confidence": 0.5,
            "scope": "workspace",
            "workspaceId": "default",
            "projectId": null,
            "sourceRunId": "run-3",
            "sourceTimestamp": null,
            "memoryType": "procedural",
            "dedupKey": null,
            "lastReinforcedAt": null,
            "archivedAt": null,
            "createdAt": "2026-03-27T11:00:00Z",
            "durable": false,
            "domain": "coding",
            "contextReleasePolicy": "full"
          }
        ]
        """.utf8))

        let groups = MemoryDayGrouper.group(memories: memories, calendar: Calendar(identifier: .gregorian))

        #expect(groups.count == 2)
        #expect(groups[0].memories.map(\.id) == ["mem-1", "mem-2"])
        #expect(groups[1].memories.map(\.id) == ["mem-3"])
    }
}
