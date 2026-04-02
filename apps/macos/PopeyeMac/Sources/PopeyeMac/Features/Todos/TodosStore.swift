import Foundation
import PopeyeAPI

@Observable @MainActor
final class TodosStore {
    var accounts: [TodoAccountDTO] = []
    var items: [TodoItemDTO] = []
    var projects: [TodoProjectDTO] = []
    var digest: TodoDigestDTO?
    var selectedAccountID: String?
    var selectedProjectName: String?
    var selectedItemID: String?
    var selectedItem: TodoItemDTO?
    var isLoading = false
    var error: APIError?
    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            accounts = []
            items = []
            projects = []
            selectedAccountID = nil
            selectedProjectName = nil
            selectedItemID = nil
            selectedItem = nil
            digest = nil
        }
    }

    private let service: TodosDomainService

    init(client: ControlAPIClient) {
        self.service = TodosDomainService(client: client)
    }

    func load() async {
        isLoading = true
        error = nil
        do {
            accounts = try await service.loadAccounts()
            if selectedAccountID == nil || accounts.contains(where: { $0.id == selectedAccountID }) == false {
                selectedAccountID = accounts.first?.id
            }
            if let selectedAccountID {
                async let loadedProjects = service.loadProjects(accountId: selectedAccountID)
                async let loadedDigest = service.loadDigest(accountId: selectedAccountID)
                projects = try await loadedProjects
                digest = try await loadedDigest
                items = try await service.loadItems(accountId: selectedAccountID, project: selectedProjectName)
                selectedItemID = selectedItemID.flatMap { id in items.contains(where: { $0.id == id }) ? id : nil } ?? items.first?.id
                if let selectedItemID {
                    selectedItem = try await service.loadItem(id: selectedItemID)
                }
            } else {
                items = []
                projects = []
                digest = nil
                selectedItem = nil
            }
        } catch let apiError as APIError {
            self.error = apiError
        } catch {
            self.error = .transportUnavailable
        }
        isLoading = false
    }

    func loadItem(id: String) async {
        do {
            selectedItem = try await service.loadItem(id: id)
        } catch {
            PopeyeLogger.refresh.error("Todo item load failed: \(error)")
        }
    }
}
