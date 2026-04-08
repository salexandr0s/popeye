import Foundation
import Observation
import PopeyeAPI

@Observable
@MainActor
final class TodosStore {
    struct Dependencies: Sendable {
        var loadAccounts: @Sendable () async throws -> [TodoAccountDTO]
        var loadItems: @Sendable (_ accountId: String, _ project: String?, _ limit: Int) async throws -> [TodoItemDTO]
        var loadItem: @Sendable (_ id: String) async throws -> TodoItemDTO
        var loadProjects: @Sendable (_ accountId: String) async throws -> [TodoProjectDTO]
        var loadDigest: @Sendable (_ accountId: String) async throws -> TodoDigestDTO?
        var syncAccount: @Sendable (_ accountId: String) async throws -> TodoSyncResultDTO
        var reconcileAccount: @Sendable (_ accountId: String) async throws -> TodoReconcileResultDTO
        var completeItem: @Sendable (_ id: String) async throws -> TodoItemDTO
        var reprioritizeItem: @Sendable (_ id: String, _ priority: Int) async throws -> TodoItemDTO
        var rescheduleItem: @Sendable (_ id: String, _ dueDate: String, _ dueTime: String?) async throws -> TodoItemDTO
        var moveItem: @Sendable (_ id: String, _ projectName: String) async throws -> TodoItemDTO
        var emitInvalidation: @Sendable (_ signal: InvalidationSignal) -> Void

        static func live(client: ControlAPIClient) -> Dependencies {
            let service = TodosDomainService(client: client)
            return Dependencies(
                loadAccounts: { try await service.loadAccounts() },
                loadItems: { accountId, project, limit in
                    try await service.loadItems(accountId: accountId, project: project, limit: limit)
                },
                loadItem: { id in try await service.loadItem(id: id) },
                loadProjects: { accountId in try await service.loadProjects(accountId: accountId) },
                loadDigest: { accountId in try await service.loadDigest(accountId: accountId) },
                syncAccount: { accountId in try await service.sync(accountId: accountId) },
                reconcileAccount: { accountId in try await service.reconcile(accountId: accountId) },
                completeItem: { id in try await service.complete(id: id) },
                reprioritizeItem: { id, priority in try await service.reprioritize(id: id, priority: priority) },
                rescheduleItem: { id, dueDate, dueTime in
                    try await service.reschedule(id: id, dueDate: dueDate, dueTime: dueTime)
                },
                moveItem: { id, projectName in try await service.move(id: id, projectName: projectName) },
                emitInvalidation: { signal in
                    NotificationCenter.default.post(name: .popeyeInvalidation, object: signal)
                }
            )
        }
    }

    var accounts: [TodoAccountDTO] = []
    var items: [TodoItemDTO] = []
    var projects: [TodoProjectDTO] = []
    var digest: TodoDigestDTO?
    var selectedAccountID: String? {
        didSet {
            guard oldValue != selectedAccountID else { return }
            selectedProjectName = nil
        }
    }
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
            lastSyncResult = nil
            lastReconcileResult = nil
            draftPriority = 4
            draftDueDate = ""
            draftDueTime = ""
            moveTargetProjectName = nil
            error = nil
            isLoading = false
            mutations.dismiss()
        }
    }

    var draftPriority = 4
    var draftDueDate = ""
    var draftDueTime = ""
    var moveTargetProjectName: String?

    var lastSyncResult: TodoSyncResultDTO?
    var lastReconcileResult: TodoReconcileResultDTO?

    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }

    private let dependencies: Dependencies

    init(client: ControlAPIClient) {
        self.dependencies = .live(client: client)
    }

    init(dependencies: Dependencies) {
        self.dependencies = dependencies
    }

    var activeAccount: TodoAccountDTO? {
        guard let selectedAccountID else { return accounts.first }
        return accounts.first(where: { $0.id == selectedAccountID }) ?? accounts.first
    }

    var canSyncSelectedAccount: Bool {
        activeAccount != nil && mutationState != .executing
    }

    var canReconcileSelectedAccount: Bool {
        activeAccount != nil && mutationState != .executing
    }

    var canCompleteSelectedItem: Bool {
        selectedItem?.status == "pending" && mutationState != .executing
    }

    var canReprioritizeSelectedItem: Bool {
        guard let item = selectedItem, item.status == "pending" else { return false }
        return draftPriority != item.priority && mutationState != .executing
    }

    var rescheduleValidationMessage: String? {
        let dueDate = draftDueDate.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !dueDate.isEmpty else { return "Enter a due date in YYYY-MM-DD format." }
        guard Self.parseDate(dueDate) != nil else { return "Use a valid due date in YYYY-MM-DD format." }

        let dueTime = normalizedDueTimeDraft
        if let dueTime, Self.parseTime(dueTime) == nil {
            return "Use a due time in HH:MM 24-hour format."
        }

        return nil
    }

    var canRescheduleSelectedItem: Bool {
        guard let item = selectedItem, item.status == "pending", mutationState != .executing else { return false }
        guard rescheduleValidationMessage == nil else { return false }
        let nextDate = draftDueDate.trimmingCharacters(in: .whitespacesAndNewlines)
        let nextTime = normalizedDueTimeDraft
        return nextDate != (item.dueDate ?? "") || nextTime != item.dueTime
    }

    var availableMoveProjects: [TodoProjectDTO] {
        guard let item = selectedItem else { return projects }
        return projects.filter { $0.name != item.projectName }
    }

    var canMoveSelectedItem: Bool {
        guard let item = selectedItem, item.status == "pending", let moveTargetProjectName else { return false }
        return !moveTargetProjectName.isEmpty
            && moveTargetProjectName != item.projectName
            && mutationState != .executing
    }

    var visibleSyncResult: TodoSyncResultDTO? {
        guard let activeAccount else { return nil }
        guard lastSyncResult?.accountId == activeAccount.id else { return nil }
        return lastSyncResult
    }

    var visibleReconcileResult: TodoReconcileResultDTO? {
        guard let activeAccount else { return nil }
        guard lastReconcileResult?.accountId == activeAccount.id else { return nil }
        return lastReconcileResult
    }

    func load() async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            accounts = try await dependencies.loadAccounts()
            if selectedAccountID == nil || accounts.contains(where: { $0.id == selectedAccountID }) == false {
                selectedAccountID = accounts.first?.id
            }

            guard let selectedAccountID else {
                items = []
                projects = []
                digest = nil
                selectedItem = nil
                selectedItemID = nil
                return
            }

            async let loadedProjects = dependencies.loadProjects(selectedAccountID)
            async let loadedDigest = dependencies.loadDigest(selectedAccountID)
            async let loadedItems = dependencies.loadItems(selectedAccountID, selectedProjectName, 100)

            projects = try await loadedProjects
            digest = try await loadedDigest
            items = try await loadedItems

            if let selectedItemID, items.contains(where: { $0.id == selectedItemID }) {
                self.selectedItemID = selectedItemID
            } else {
                self.selectedItemID = items.first?.id
            }

            if let selectedItemID {
                selectedItem = try await dependencies.loadItem(selectedItemID)
                seedDraftsFromSelectedItem()
            } else {
                selectedItem = nil
                seedDraftsFromSelectedItem()
            }
        } catch let apiError as APIError {
            self.error = apiError
        } catch {
            self.error = .transportUnavailable
        }
    }

    func loadItem(id: String) async {
        do {
            selectedItem = try await dependencies.loadItem(id)
            seedDraftsFromSelectedItem()
        } catch {
            PopeyeLogger.refresh.error("Todo item load failed: \(error)")
        }
    }

    func syncSelectedAccount() async {
        guard let account = activeAccount else { return }
        await mutations.execute(
            action: {
                self.lastSyncResult = try await self.dependencies.syncAccount(account.id)
                self.dependencies.emitInvalidation(.general)
            },
            successMessage: "Todo account synced",
            fallbackError: "Couldn't sync todo account",
            reload: { [weak self] in
                await self?.load()
            }
        )
    }

    func reconcileSelectedAccount() async {
        guard let account = activeAccount else { return }
        await mutations.execute(
            action: {
                self.lastReconcileResult = try await self.dependencies.reconcileAccount(account.id)
                self.dependencies.emitInvalidation(.general)
            },
            successMessage: "Todo account reconciled",
            fallbackError: "Couldn't reconcile todo account",
            reload: { [weak self] in
                await self?.load()
            }
        )
    }

    func completeSelectedItem() async {
        guard let item = selectedItem, item.status == "pending" else { return }
        await mutations.execute(
            action: {
                _ = try await self.dependencies.completeItem(item.id)
                self.dependencies.emitInvalidation(.general)
            },
            successMessage: "Todo completed",
            fallbackError: "Couldn't complete todo",
            reload: { [weak self] in
                await self?.load()
            }
        )
    }

    func reprioritizeSelectedItem() async {
        guard let item = selectedItem, canReprioritizeSelectedItem else { return }
        await mutations.execute(
            action: {
                _ = try await self.dependencies.reprioritizeItem(item.id, self.draftPriority)
                self.dependencies.emitInvalidation(.general)
            },
            successMessage: "Todo reprioritized",
            fallbackError: "Couldn't update todo priority",
            reload: { [weak self] in
                await self?.load()
            }
        )
    }

    func rescheduleSelectedItem() async {
        guard let item = selectedItem, canRescheduleSelectedItem else { return }
        let dueDate = draftDueDate.trimmingCharacters(in: .whitespacesAndNewlines)
        let dueTime = normalizedDueTimeDraft
        await mutations.execute(
            action: {
                _ = try await self.dependencies.rescheduleItem(item.id, dueDate, dueTime)
                self.dependencies.emitInvalidation(.general)
            },
            successMessage: "Todo rescheduled",
            fallbackError: "Couldn't reschedule todo",
            reload: { [weak self] in
                await self?.load()
            }
        )
    }

    func moveSelectedItem() async {
        guard let item = selectedItem, let moveTargetProjectName, canMoveSelectedItem else { return }
        await mutations.execute(
            action: {
                _ = try await self.dependencies.moveItem(item.id, moveTargetProjectName)
                self.dependencies.emitInvalidation(.general)
            },
            successMessage: "Todo moved",
            fallbackError: "Couldn't move todo",
            reload: { [weak self] in
                await self?.load()
            }
        )
    }

    func dismissMutation() {
        mutations.dismiss()
    }

    private var normalizedDueTimeDraft: String? {
        let dueTime = draftDueTime.trimmingCharacters(in: .whitespacesAndNewlines)
        return dueTime.isEmpty ? nil : dueTime
    }

    private func seedDraftsFromSelectedItem() {
        draftPriority = selectedItem?.priority ?? 4
        draftDueDate = selectedItem?.dueDate ?? ""
        draftDueTime = selectedItem?.dueTime ?? ""
        moveTargetProjectName = nil
    }

    private static func parseDate(_ value: String) -> Date? {
        todoDateFormatter.date(from: value)
    }

    private static func parseTime(_ value: String) -> Date? {
        todoTimeFormatter.date(from: value)
    }
}

private let todoDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.isLenient = false
    return formatter
}()

private let todoTimeFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "HH:mm"
    formatter.isLenient = false
    return formatter
}()
