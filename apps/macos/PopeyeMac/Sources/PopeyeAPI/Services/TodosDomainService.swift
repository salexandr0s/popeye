import Foundation

public struct TodosDomainService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadAccounts() async throws -> [TodoAccountDTO] {
        try await client.listTodoAccounts()
    }

    public func loadItems(accountId: String, project: String? = nil, limit: Int = 100) async throws -> [TodoItemDTO] {
        try await client.listTodoItems(accountId: accountId, project: project, limit: limit)
    }

    public func loadItem(id: String) async throws -> TodoItemDTO {
        try await client.getTodoItem(id: id)
    }

    public func loadProjects(accountId: String) async throws -> [TodoProjectDTO] {
        try await client.listTodoProjects(accountId: accountId)
    }

    public func loadDigest(accountId: String) async throws -> TodoDigestDTO? {
        try await client.todoDigest(accountId: accountId)
    }

    public func sync(accountId: String) async throws -> TodoSyncResultDTO {
        try await client.syncTodoAccount(accountId: accountId)
    }

    public func reconcile(accountId: String) async throws -> TodoReconcileResultDTO {
        try await client.reconcileTodoAccount(accountId: accountId)
    }

    public func complete(id: String) async throws -> TodoItemDTO {
        try await client.completeTodo(id: id)
    }

    public func reprioritize(id: String, priority: Int) async throws -> TodoItemDTO {
        try await client.reprioritizeTodo(id: id, input: TodoReprioritizeInput(priority: priority))
    }

    public func reschedule(id: String, dueDate: String, dueTime: String?) async throws -> TodoItemDTO {
        try await client.rescheduleTodo(id: id, input: TodoRescheduleInput(dueDate: dueDate, dueTime: dueTime))
    }

    public func move(id: String, projectName: String) async throws -> TodoItemDTO {
        try await client.moveTodo(id: id, input: TodoMoveInput(projectName: projectName))
    }
}
