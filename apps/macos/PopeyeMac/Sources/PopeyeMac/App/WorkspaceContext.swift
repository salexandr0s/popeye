import Foundation
import Observation
import PopeyeAPI

@Observable @MainActor
final class WorkspaceContext {
    @ObservationIgnored
    private let storage: UserDefaults

    @ObservationIgnored
    var onSelectionChanged: ((String) -> Void)?

    var workspaces: [WorkspaceRecordDTO] = []
    var selectedWorkspaceID: String {
        didSet {
            guard oldValue != selectedWorkspaceID else { return }
            storage.set(selectedWorkspaceID, forKey: StorageKey.selectedWorkspaceID)
            onSelectionChanged?(selectedWorkspaceID)
        }
    }

    init(storage: UserDefaults = .standard) {
        self.storage = storage
        self.selectedWorkspaceID = storage.string(forKey: StorageKey.selectedWorkspaceID) ?? "default"
    }

    var selectedWorkspace: WorkspaceRecordDTO? {
        workspaces.first { $0.id == selectedWorkspaceID }
    }

    func replaceWorkspaces(_ newWorkspaces: [WorkspaceRecordDTO]) {
        workspaces = newWorkspaces

        if newWorkspaces.contains(where: { $0.id == selectedWorkspaceID }) {
            onSelectionChanged?(selectedWorkspaceID)
        } else {
            selectedWorkspaceID = newWorkspaces.first?.id ?? "default"
        }
    }

    func clear() {
        workspaces = []
        selectedWorkspaceID = "default"
    }
}

private enum StorageKey {
    static let selectedWorkspaceID = "selectedWorkspaceID"
}
