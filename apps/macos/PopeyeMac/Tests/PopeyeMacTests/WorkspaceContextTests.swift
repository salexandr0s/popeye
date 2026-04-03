import Foundation
import Testing
@testable import PopeyeAPI
@testable import PopeyeMac

@MainActor
@Suite("Workspace Context")
struct WorkspaceContextTests {
    @Test("Persists workspace selection changes")
    func persistsWorkspaceSelection() {
        let storage = testDefaults()
        let context = WorkspaceContext(storage: storage)

        context.selectedWorkspaceID = "primary"

        #expect(storage.string(forKey: "selectedWorkspaceID") == "primary")
    }

    @Test("Falls back to the first available workspace when the current one disappears")
    func fallsBackToFirstWorkspace() {
        let storage = testDefaults()
        storage.set("missing", forKey: "selectedWorkspaceID")

        let context = WorkspaceContext(storage: storage)
        context.replaceWorkspaces([
            workspace(id: "alpha", name: "Alpha"),
            workspace(id: "beta", name: "Beta"),
        ])

        #expect(context.selectedWorkspaceID == "alpha")
        #expect(context.selectedWorkspace?.name == "Alpha")
    }

    @Test("Preserves the selected workspace when it still exists")
    func preservesExistingSelection() {
        let storage = testDefaults()
        storage.set("beta", forKey: "selectedWorkspaceID")

        let context = WorkspaceContext(storage: storage)
        context.replaceWorkspaces([
            workspace(id: "alpha", name: "Alpha"),
            workspace(id: "beta", name: "Beta"),
        ])

        #expect(context.selectedWorkspaceID == "beta")
        #expect(context.selectedWorkspace?.name == "Beta")
    }

    private func testDefaults() -> UserDefaults {
        let suiteName = "popeye.tests.workspace.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return defaults
    }

    private func workspace(id: String, name: String) -> WorkspaceRecordDTO {
        WorkspaceRecordDTO(
            id: id,
            name: name,
            rootPath: "/tmp/\(id)",
            createdAt: "2026-04-01T10:00:00Z"
        )
    }
}
