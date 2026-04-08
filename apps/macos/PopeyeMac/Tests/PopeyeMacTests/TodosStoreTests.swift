import Foundation
import Testing

@testable import PopeyeAPI
@testable import PopeyeMac

@MainActor
@Suite("Todos Store")
struct TodosStoreTests {
    @Test("Load selects the default account and item detail")
    func loadHydratesSelectedItem() async {
        let store = TodosStore(dependencies: .stub())

        await store.load()

        #expect(store.accounts.count == 1)
        #expect(store.selectedAccountID == "todo-acct-1")
        #expect(store.selectedItemID == "todo-1")
        #expect(store.selectedItem?.id == "todo-1")
        #expect(store.draftPriority == 3)
    }

    @Test("Complete mutation updates the selected item and disables further item actions")
    func completeSelectedItem() async {
        let state = TodoStateBox(initial: sampleTodoItem())
        let store = TodosStore(dependencies: .stub(
            loadItems: { accountId, project, limit in
                await state.listItems(accountId: accountId, project: project, limit: limit)
            },
            loadItem: { id in
                await state.loadItem(id: id)
            },
            completeItem: { id in
                await state.complete(id: id)
            }
        ))

        await store.load()
        await store.completeSelectedItem()

        #expect(store.selectedItem?.status == "completed")
        #expect(store.canCompleteSelectedItem == false)
        #expect(store.mutationState == .succeeded("Todo completed"))
    }

    @Test("Reprioritize, reschedule, and move mutations reload the selected item")
    func itemMutationsReloadSelection() async {
        let state = TodoStateBox(initial: sampleTodoItem())
        let store = TodosStore(dependencies: .stub(
            loadItems: { accountId, project, limit in
                await state.listItems(accountId: accountId, project: project, limit: limit)
            },
            loadItem: { id in
                await state.loadItem(id: id)
            },
            reprioritizeItem: { id, priority in
                await state.reprioritize(id: id, priority: priority)
            },
            rescheduleItem: { id, dueDate, dueTime in
                await state.reschedule(id: id, dueDate: dueDate, dueTime: dueTime)
            },
            moveItem: { id, projectName in
                await state.move(id: id, projectName: projectName)
            }
        ))

        await store.load()

        store.draftPriority = 1
        await store.reprioritizeSelectedItem()
        #expect(store.selectedItem?.priority == 1)

        store.draftDueDate = "2026-04-12"
        store.draftDueTime = "09:30"
        await store.rescheduleSelectedItem()
        #expect(store.selectedItem?.dueDate == "2026-04-12")
        #expect(store.selectedItem?.dueTime == "09:30")

        store.moveTargetProjectName = "Today"
        await store.moveSelectedItem()
        #expect(store.selectedItem?.projectName == "Today")
        #expect(store.mutationState == .succeeded("Todo moved"))
    }

    @Test("Sync and reconcile update account operation summaries")
    func accountOperationsUpdateSummaries() async {
        let store = TodosStore(dependencies: .stub(
            syncAccount: { accountId in
                TodoSyncResultDTO(accountId: accountId, todosSynced: 4, todosUpdated: 2, errors: [])
            },
            reconcileAccount: { accountId in
                TodoReconcileResultDTO(accountId: accountId, added: 1, updated: 2, removed: 0, errors: [])
            }
        ))

        await store.load()
        await store.syncSelectedAccount()

        #expect(store.visibleSyncResult?.todosSynced == 4)
        #expect(store.mutationState == .succeeded("Todo account synced"))

        await store.reconcileSelectedAccount()

        #expect(store.visibleReconcileResult?.updated == 2)
        #expect(store.mutationState == .succeeded("Todo account reconciled"))
    }

    @Test("Validation gates reschedule and move actions")
    func validationGuardsMutations() async {
        let store = TodosStore(dependencies: .stub())

        await store.load()

        #expect(store.canRescheduleSelectedItem == false)
        store.draftDueDate = "2026-99-99"
        #expect(store.rescheduleValidationMessage != nil)
        #expect(store.canRescheduleSelectedItem == false)

        store.draftDueDate = "2026-04-15"
        store.draftDueTime = "25:00"
        #expect(store.canRescheduleSelectedItem == false)

        store.draftDueTime = "10:45"
        #expect(store.canRescheduleSelectedItem == true)

        #expect(store.canMoveSelectedItem == false)
        store.moveTargetProjectName = "Today"
        #expect(store.canMoveSelectedItem == true)
    }
}

extension TodosStore.Dependencies {
    fileprivate static func stub(
        loadAccounts: @escaping @Sendable () async throws -> [TodoAccountDTO] = {
            [sampleTodoAccount()]
        },
        loadItems: @escaping @Sendable (_ accountId: String, _ project: String?, _ limit: Int) async throws -> [TodoItemDTO] = { accountId, project, _ in
            let item = sampleTodoItem(accountId: accountId)
            guard project == nil || item.projectName == project else { return [] }
            return [item]
        },
        loadItem: @escaping @Sendable (_ id: String) async throws -> TodoItemDTO = { _ in
            sampleTodoItem()
        },
        loadProjects: @escaping @Sendable (_ accountId: String) async throws -> [TodoProjectDTO] = { accountId in
            [sampleTodoProject(accountId: accountId, name: "Inbox"), sampleTodoProject(accountId: accountId, name: "Today")]
        },
        loadDigest: @escaping @Sendable (_ accountId: String) async throws -> TodoDigestDTO? = { accountId in
            sampleTodoDigest(accountId: accountId)
        },
        syncAccount: @escaping @Sendable (_ accountId: String) async throws -> TodoSyncResultDTO = { accountId in
            TodoSyncResultDTO(accountId: accountId, todosSynced: 2, todosUpdated: 1, errors: [])
        },
        reconcileAccount: @escaping @Sendable (_ accountId: String) async throws -> TodoReconcileResultDTO = { accountId in
            TodoReconcileResultDTO(accountId: accountId, added: 1, updated: 1, removed: 0, errors: [])
        },
        completeItem: @escaping @Sendable (_ id: String) async throws -> TodoItemDTO = { _ in
            sampleTodoItem(status: "completed", completedAt: "2026-04-08T10:00:00Z")
        },
        reprioritizeItem: @escaping @Sendable (_ id: String, _ priority: Int) async throws -> TodoItemDTO = { _, priority in
            sampleTodoItem(priority: priority)
        },
        rescheduleItem: @escaping @Sendable (_ id: String, _ dueDate: String, _ dueTime: String?) async throws -> TodoItemDTO = { _, dueDate, dueTime in
            sampleTodoItem(dueDate: dueDate, dueTime: dueTime)
        },
        moveItem: @escaping @Sendable (_ id: String, _ projectName: String) async throws -> TodoItemDTO = { _, projectName in
            sampleTodoItem(projectName: projectName)
        },
        emitInvalidation: @escaping @Sendable (_ signal: InvalidationSignal) -> Void = { _ in }
    ) -> Self {
        Self(
            loadAccounts: loadAccounts,
            loadItems: loadItems,
            loadItem: loadItem,
            loadProjects: loadProjects,
            loadDigest: loadDigest,
            syncAccount: syncAccount,
            reconcileAccount: reconcileAccount,
            completeItem: completeItem,
            reprioritizeItem: reprioritizeItem,
            rescheduleItem: rescheduleItem,
            moveItem: moveItem,
            emitInvalidation: emitInvalidation
        )
    }
}

private actor TodoStateBox {
    private var item: TodoItemDTO

    init(initial: TodoItemDTO) {
        item = initial
    }

    func listItems(accountId: String, project: String?, limit _: Int) -> [TodoItemDTO] {
        guard item.accountId == accountId else { return [] }
        guard project == nil || item.projectName == project else { return [] }
        return [item]
    }

    func loadItem(id: String) -> TodoItemDTO {
        precondition(item.id == id)
        return item
    }

    func complete(id: String) -> TodoItemDTO {
        precondition(item.id == id)
        item = sampleTodoItem(
            accountId: item.accountId,
            priority: item.priority,
            status: "completed",
            dueDate: item.dueDate,
            dueTime: item.dueTime,
            projectName: item.projectName,
            completedAt: "2026-04-08T10:00:00Z"
        )
        return item
    }

    func reprioritize(id: String, priority: Int) -> TodoItemDTO {
        precondition(item.id == id)
        item = sampleTodoItem(
            accountId: item.accountId,
            priority: priority,
            status: item.status,
            dueDate: item.dueDate,
            dueTime: item.dueTime,
            projectName: item.projectName,
            completedAt: item.completedAt
        )
        return item
    }

    func reschedule(id: String, dueDate: String, dueTime: String?) -> TodoItemDTO {
        precondition(item.id == id)
        item = sampleTodoItem(
            accountId: item.accountId,
            priority: item.priority,
            status: item.status,
            dueDate: dueDate,
            dueTime: dueTime,
            projectName: item.projectName,
            completedAt: item.completedAt
        )
        return item
    }

    func move(id: String, projectName: String) -> TodoItemDTO {
        precondition(item.id == id)
        item = sampleTodoItem(
            accountId: item.accountId,
            priority: item.priority,
            status: item.status,
            dueDate: item.dueDate,
            dueTime: item.dueTime,
            projectName: projectName,
            completedAt: item.completedAt
        )
        return item
    }
}

private func sampleTodoAccount() -> TodoAccountDTO {
    TodoAccountDTO(
        id: "todo-acct-1",
        connectionId: "conn-todo-1",
        providerKind: "google_tasks",
        displayName: "Personal Tasks",
        syncCursorSince: nil,
        lastSyncAt: "2026-04-08T09:00:00Z",
        todoCount: 3,
        createdAt: "2026-04-01T08:00:00Z",
        updatedAt: "2026-04-08T09:00:00Z"
    )
}

private func sampleTodoItem(
    accountId: String = "todo-acct-1",
    priority: Int = 3,
    status: String = "pending",
    dueDate: String? = "2026-04-10",
    dueTime: String? = nil,
    projectName: String? = "Inbox",
    completedAt: String? = nil
) -> TodoItemDTO {
    TodoItemDTO(
        id: "todo-1",
        accountId: accountId,
        externalId: "ext-1",
        title: "Review inbox triage",
        description: "Check new PRs and route follow-ups.",
        priority: priority,
        status: status,
        dueDate: dueDate,
        dueTime: dueTime,
        labels: ["today"],
        projectId: projectName?.lowercased(),
        projectName: projectName,
        parentId: nil,
        completedAt: completedAt,
        createdAtExternal: "2026-04-01T08:00:00Z",
        updatedAtExternal: "2026-04-08T09:00:00Z",
        createdAt: "2026-04-01T08:00:00Z",
        updatedAt: "2026-04-08T09:00:00Z"
    )
}

private func sampleTodoProject(accountId: String, name: String) -> TodoProjectDTO {
    TodoProjectDTO(
        id: "project-\(name.lowercased())",
        accountId: accountId,
        externalId: "ext-\(name.lowercased())",
        name: name,
        color: "#448AFF",
        todoCount: 2,
        createdAt: "2026-04-01T08:00:00Z",
        updatedAt: "2026-04-08T09:00:00Z"
    )
}

private func sampleTodoDigest(accountId: String) -> TodoDigestDTO {
    TodoDigestDTO(
        id: "digest-1",
        accountId: accountId,
        workspaceId: "default",
        date: "2026-04-08",
        pendingCount: 3,
        overdueCount: 1,
        completedTodayCount: 1,
        summaryMarkdown: "Three tasks need attention today.",
        generatedAt: "2026-04-08T09:00:00Z"
    )
}
