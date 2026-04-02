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
}
