import Foundation
import Testing
@testable import PopeyeAPI
@testable import PopeyeMac

@MainActor
@Suite("Files Store")
struct FilesStoreTests {
    @Test("Load transitions to empty when no roots are returned")
    func loadEmpty() async {
        let store = FilesStore(dependencies: .stub(loadRoots: { _ in [] }))

        await store.load()

        #expect(store.loadPhase == .empty)
        #expect(store.roots.isEmpty)
        #expect(store.selectedRoot == nil)
    }

    @Test("Search failure preserves current results and surfaces a recoverable error")
    func searchFailurePreservesResults() async {
        let existing = fileSearchResult(documentId: "doc-existing")
        let store = FilesStore(dependencies: .stub(
            loadRoots: { _ in [fileRoot()] },
            search: { _, _, _, _ in throw APIError.forbidden }
        ))
        store.searchText = "memory"
        store.searchResults = [existing]

        await store.search()

        #expect(store.searchResults == [existing])
        #expect(store.searchPhase == .failed(.forbidden))
    }

    @Test("Create root enters executing, then succeeds and reloads roots")
    func createRootMutationFlow() async {
        let gate = AsyncGate<FileRootDTO>()
        let createdRoot = fileRoot(id: "root-created", label: "Created Root")
        let store = FilesStore(dependencies: .stub(
            loadRoots: { _ in [createdRoot] },
            loadRoot: { _ in createdRoot },
            loadWriteIntents: { _ in [] },
            createRoot: { _ in await gate.wait() }
        ))

        let task = Task {
            await store.createRoot(input: FileRootRegistrationInput(workspaceId: "preview", label: "Created Root", rootPath: "/tmp/root"))
        }

        await Task.yield()
        #expect(store.mutationState == .executing)

        await gate.resume(with: createdRoot)
        await task.value

        #expect(store.mutationState == .succeeded("Added file root Created Root."))
        #expect(store.selectedRootID == createdRoot.id)
        #expect(store.roots == [createdRoot])
        #expect(store.loadPhase == .loaded)
    }
}

@MainActor
@Suite("Finance Store")
struct FinanceStoreTests {
    @Test("Load failure surfaces a failed root phase")
    func loadFailure() async {
        let store = FinanceStore(dependencies: .stub(loadVaults: { throw APIError.transportUnavailable }))

        await store.load()

        #expect(store.loadPhase == .failed(.transportUnavailable))
    }

    @Test("Selection failure preserves existing detail content")
    func selectionFailurePreservesContent() async {
        let existingTransaction = financeTransaction(id: "txn-existing")
        let existingDocument = financeDocument(id: "doc-existing")
        let store = FinanceStore(dependencies: .stub(
            loadTransactions: { _, _ in throw APIError.notFound },
            loadDocuments: { _ in throw APIError.notFound }
        ))
        store.selectedImportID = "fin-import-001"
        store.transactions = [existingTransaction]
        store.documents = [existingDocument]

        await store.reloadSelection()

        #expect(store.transactions == [existingTransaction])
        #expect(store.documents == [existingDocument])
        #expect(store.selectionPhase == .failed(.notFound))
    }

    @Test("Digest mutation failure reports through shared mutation state")
    func triggerDigestFailure() async {
        let store = FinanceStore(dependencies: .stub(triggerDigest: { _ in throw APIError.forbidden }))

        await store.triggerDigest()

        #expect(store.mutationState == .failed(APIError.forbidden.userMessage))
    }
}

@MainActor
@Suite("Medical Store")
struct MedicalStoreTests {
    @Test("Load transitions to empty when no imports are available")
    func loadEmpty() async {
        let store = MedicalStore(dependencies: .stub(loadVaults: { [vault(domain: "medical")] }, loadImports: { [] }))

        await store.load()

        #expect(store.loadPhase == .empty)
        #expect(store.imports.isEmpty)
    }

    @Test("Search failure preserves current search results")
    func searchFailurePreservesResults() async {
        let existing = medicalSearchResult(recordId: "record-existing")
        let store = MedicalStore(dependencies: .stub(search: { _, _ in throw APIError.unauthorized }))
        store.searchText = "follow-up"
        store.searchResults = [existing]

        await store.search()

        #expect(store.searchResults == [existing])
        #expect(store.searchPhase == .failed(.unauthorized))
    }

    @Test("Create appointment succeeds and reloads selection data")
    func createAppointmentSuccess() async {
        let updatedAppointment = medicalAppointment(id: "appt-new")
        let store = MedicalStore(dependencies: .stub(
            loadAppointments: { _, _ in [updatedAppointment] },
            loadMedications: { _ in [] },
            loadDocuments: { _ in [] },
            createAppointment: { _ in updatedAppointment }
        ))
        store.selectedImportID = "med-import-001"

        await store.createAppointment(input: MedicalAppointmentCreateInput(importId: "med-import-001", date: "2026-04-11T14:00:00Z", provider: "Dr. Smith"))

        #expect(store.mutationState == MutationState.succeeded("Added a medical appointment."))
        #expect(store.appointments == [updatedAppointment])
        #expect(store.selectionPhase == ScreenOperationPhase.idle)
    }
}

private actor AsyncGate<Value: Sendable> {
    private var continuation: CheckedContinuation<Value, Never>?

    func wait() async -> Value {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func resume(with value: Value) {
        continuation?.resume(returning: value)
        continuation = nil
    }
}

private extension FilesStore.Dependencies {
    static func stub(
        loadRoots: @Sendable @escaping (_ workspaceID: String) async throws -> [FileRootDTO] = { _ in [fileRoot()] },
        loadRoot: @Sendable @escaping (_ id: String) async throws -> FileRootDTO = { _ in fileRoot() },
        search: @Sendable @escaping (_ query: String, _ rootID: String?, _ workspaceID: String, _ limit: Int) async throws -> FileSearchResponseDTO = { query, _, _, _ in fileSearchResponse(query: query) },
        loadDocument: @Sendable @escaping (_ id: String) async throws -> FileDocumentDTO = { _ in fileDocument() },
        loadWriteIntents: @Sendable @escaping (_ rootID: String?) async throws -> [FileWriteIntentDTO] = { _ in [] },
        createRoot: @Sendable @escaping (_ input: FileRootRegistrationInput) async throws -> FileRootDTO = { _ in fileRoot() },
        updateRoot: @Sendable @escaping (_ id: String, _ input: FileRootUpdateInput) async throws -> FileRootDTO = { _, _ in fileRoot() },
        deleteRoot: @Sendable @escaping (_ id: String) async throws -> Void = { _ in },
        reindexRoot: @Sendable @escaping (_ id: String) async throws -> FileIndexResultDTO = { _ in fileIndexResult() },
        reviewWriteIntent: @Sendable @escaping (_ id: String, _ action: String, _ reason: String?) async throws -> FileWriteIntentDTO = { _, _, _ in fileWriteIntent() }
    ) -> Self {
        Self(
            loadRoots: loadRoots,
            loadRoot: loadRoot,
            search: search,
            loadDocument: loadDocument,
            loadWriteIntents: loadWriteIntents,
            createRoot: createRoot,
            updateRoot: updateRoot,
            deleteRoot: deleteRoot,
            reindexRoot: reindexRoot,
            reviewWriteIntent: reviewWriteIntent
        )
    }
}

private extension FinanceStore.Dependencies {
    static func stub(
        loadVaults: @Sendable @escaping () async throws -> [VaultRecordDTO] = { [vault(domain: "finance")] },
        loadImports: @Sendable @escaping () async throws -> [FinanceImportDTO] = { [financeImport()] },
        loadDigest: @Sendable @escaping (_ period: String?) async throws -> FinanceDigestDTO? = { _ in financeDigest() },
        loadTransactions: @Sendable @escaping (_ importID: String?, _ limit: Int?) async throws -> [FinanceTransactionDTO] = { _, _ in [financeTransaction()] },
        loadDocuments: @Sendable @escaping (_ importID: String?) async throws -> [FinanceDocumentDTO] = { _ in [financeDocument()] },
        search: @Sendable @escaping (_ query: String, _ limit: Int) async throws -> FinanceSearchResponseDTO = { query, _ in financeSearchResponse(query: query) },
        triggerDigest: @Sendable @escaping (_ period: String?) async throws -> FinanceDigestDTO = { _ in financeDigest() },
        createImport: @Sendable @escaping (_ vaultID: String, _ importType: String, _ fileName: String) async throws -> FinanceImportDTO = { _, _, _ in financeImport() },
        createTransaction: @Sendable @escaping (_ input: FinanceTransactionCreateInput) async throws -> FinanceTransactionDTO = { _ in financeTransaction() },
        updateImportStatus: @Sendable @escaping (_ id: String, _ status: String, _ recordCount: Int?) async throws -> Void = { _, _, _ in },
        openVault: @Sendable @escaping (_ id: String) async throws -> VaultRecordDTO = { _ in vault(domain: "finance") },
        closeVault: @Sendable @escaping (_ id: String) async throws -> VaultRecordDTO = { _ in vault(domain: "finance") }
    ) -> Self {
        Self(
            loadVaults: loadVaults,
            loadImports: loadImports,
            loadDigest: loadDigest,
            loadTransactions: loadTransactions,
            loadDocuments: loadDocuments,
            search: search,
            triggerDigest: triggerDigest,
            createImport: createImport,
            createTransaction: createTransaction,
            updateImportStatus: updateImportStatus,
            openVault: openVault,
            closeVault: closeVault
        )
    }
}

private extension MedicalStore.Dependencies {
    static func stub(
        loadVaults: @Sendable @escaping () async throws -> [VaultRecordDTO] = { [vault(domain: "medical")] },
        loadImports: @Sendable @escaping () async throws -> [MedicalImportDTO] = { [medicalImport()] },
        loadDigest: @Sendable @escaping (_ period: String?) async throws -> MedicalDigestDTO? = { _ in medicalDigest() },
        loadAppointments: @Sendable @escaping (_ importID: String?, _ limit: Int?) async throws -> [MedicalAppointmentDTO] = { _, _ in [medicalAppointment()] },
        loadMedications: @Sendable @escaping (_ importID: String?) async throws -> [MedicalMedicationDTO] = { _ in [medicalMedication()] },
        loadDocuments: @Sendable @escaping (_ importID: String?) async throws -> [MedicalDocumentDTO] = { _ in [medicalDocument()] },
        search: @Sendable @escaping (_ query: String, _ limit: Int) async throws -> MedicalSearchResponseDTO = { query, _ in medicalSearchResponse(query: query) },
        triggerDigest: @Sendable @escaping (_ period: String?) async throws -> MedicalDigestDTO = { _ in medicalDigest() },
        createImport: @Sendable @escaping (_ vaultID: String, _ importType: String, _ fileName: String) async throws -> MedicalImportDTO = { _, _, _ in medicalImport() },
        createAppointment: @Sendable @escaping (_ input: MedicalAppointmentCreateInput) async throws -> MedicalAppointmentDTO = { _ in medicalAppointment() },
        createMedication: @Sendable @escaping (_ input: MedicalMedicationCreateInput) async throws -> MedicalMedicationDTO = { _ in medicalMedication() },
        createDocument: @Sendable @escaping (_ input: MedicalDocumentCreateInput) async throws -> MedicalDocumentDTO = { _ in medicalDocument() },
        updateImportStatus: @Sendable @escaping (_ id: String, _ status: String) async throws -> Void = { _, _ in },
        openVault: @Sendable @escaping (_ id: String) async throws -> VaultRecordDTO = { _ in vault(domain: "medical") },
        closeVault: @Sendable @escaping (_ id: String) async throws -> VaultRecordDTO = { _ in vault(domain: "medical") }
    ) -> Self {
        Self(
            loadVaults: loadVaults,
            loadImports: loadImports,
            loadDigest: loadDigest,
            loadAppointments: loadAppointments,
            loadMedications: loadMedications,
            loadDocuments: loadDocuments,
            search: search,
            triggerDigest: triggerDigest,
            createImport: createImport,
            createAppointment: createAppointment,
            createMedication: createMedication,
            createDocument: createDocument,
            updateImportStatus: updateImportStatus,
            openVault: openVault,
            closeVault: closeVault
        )
    }
}

private func fileRoot(id: String = "root-001", label: String = "Workspace Notes") -> FileRootDTO {
    FileRootDTO(
        id: id,
        workspaceId: "preview-workspace",
        label: label,
        rootPath: "/tmp/preview/docs",
        permission: "index",
        filePatterns: ["**/*.md"],
        excludePatterns: [],
        maxFileSizeBytes: 1_048_576,
        enabled: true,
        lastIndexedAt: "2026-04-03T09:30:00Z",
        lastIndexedCount: 12,
        createdAt: "2026-04-01T08:00:00Z",
        updatedAt: "2026-04-03T09:30:00Z"
    )
}

private func fileDocument(id: String = "doc-001") -> FileDocumentDTO {
    FileDocumentDTO(
        id: id,
        fileRootId: "root-001",
        relativePath: "memory/MEMORY.md",
        contentHash: "abc123",
        sizeBytes: 4096,
        memoryId: "mem-001",
        createdAt: "2026-04-02T11:00:00Z",
        updatedAt: "2026-04-03T08:45:00Z"
    )
}

private func fileSearchResult(documentId: String = "doc-001") -> FileSearchResultDTO {
    FileSearchResultDTO(
        documentId: documentId,
        fileRootId: "root-001",
        relativePath: "memory/MEMORY.md",
        memoryId: "mem-001",
        score: 0.96,
        snippet: "Recent memory promotions and operator notes."
    )
}

private func fileSearchResponse(query: String) -> FileSearchResponseDTO {
    let payload = """
    {
      "query": "\(query)",
      "results": [
        {
          "document_id": "doc-001",
          "file_root_id": "root-001",
          "relative_path": "memory/MEMORY.md",
          "memory_id": "mem-001",
          "score": 0.96,
          "snippet": "Recent memory promotions and operator notes."
        }
      ],
      "total_candidates": 1
    }
    """
    return decode(payload, as: FileSearchResponseDTO.self)
}

private func fileIndexResult() -> FileIndexResultDTO {
    FileIndexResultDTO(rootId: "root-001", indexed: 12, updated: 2, skipped: 0, stale: 0, errors: [])
}

private func fileWriteIntent() -> FileWriteIntentDTO {
    FileWriteIntentDTO(
        id: "intent-001",
        fileRootId: "root-001",
        filePath: "memory/MEMORY.md",
        intentType: "append",
        diffPreview: "+ Added refreshed memory summary",
        status: "pending",
        runId: "run-001",
        approvalId: nil,
        receiptId: nil,
        createdAt: "2026-04-03T09:35:00Z",
        reviewedAt: nil
    )
}

private func vault(domain: String) -> VaultRecordDTO {
    VaultRecordDTO(
        id: "vault-\(domain)-001",
        domain: domain,
        kind: "sqlite",
        dbPath: "/tmp/\(domain).db",
        encrypted: true,
        encryptionKeyRef: "keychain:\(domain)",
        status: "closed",
        createdAt: "2026-03-01T09:00:00Z",
        lastAccessedAt: nil
    )
}

private func financeImport() -> FinanceImportDTO {
    FinanceImportDTO(
        id: "fin-import-001",
        vaultId: "vault-finance-001",
        importType: "csv",
        fileName: "march-transactions.csv",
        status: "reviewed",
        recordCount: 42,
        importedAt: "2026-04-01T09:00:00Z"
    )
}

private func financeTransaction(id: String = "txn-001") -> FinanceTransactionDTO {
    FinanceTransactionDTO(
        id: id,
        importId: "fin-import-001",
        date: "2026-03-28T00:00:00Z",
        description: "Groceries",
        amount: -84.12,
        currency: "USD",
        category: "groceries",
        merchantName: "Corner Market",
        accountLabel: "Checking",
        redactedSummary: "Weekly grocery spend"
    )
}

private func financeDocument(id: String = "fin-doc-001") -> FinanceDocumentDTO {
    FinanceDocumentDTO(
        id: id,
        importId: "fin-import-001",
        fileName: "statement.pdf",
        mimeType: "application/pdf",
        sizeBytes: 8192,
        redactedSummary: "Monthly statement"
    )
}

private func financeDigest() -> FinanceDigestDTO {
    FinanceDigestDTO(
        id: "fin-digest-001",
        period: "month",
        totalIncome: 4200,
        totalExpenses: 84.12,
        categoryBreakdown: ["groceries": -84.12],
        anomalyFlags: [],
        generatedAt: "2026-04-03T09:40:00Z"
    )
}

private func financeSearchResponse(query: String) -> FinanceSearchResponseDTO {
    let payload = """
    {
      "query": "\(query)",
      "results": [
        {
          "transaction_id": "txn-001",
          "date": "2026-03-28T00:00:00Z",
          "description": "Groceries",
          "amount": -84.12,
          "redacted_summary": "Weekly grocery spend",
          "score": 0.91
        }
      ]
    }
    """
    return decode(payload, as: FinanceSearchResponseDTO.self)
}

private func medicalImport() -> MedicalImportDTO {
    MedicalImportDTO(
        id: "med-import-001",
        vaultId: "vault-medical-001",
        importType: "pdf",
        fileName: "quarterly-summary.pdf",
        status: "reviewed",
        importedAt: "2026-04-01T09:00:00Z"
    )
}

private func medicalAppointment(id: String = "appt-001") -> MedicalAppointmentDTO {
    MedicalAppointmentDTO(
        id: id,
        importId: "med-import-001",
        date: "2026-04-11T14:00:00Z",
        provider: "Dr. Smith",
        specialty: "Primary Care",
        location: "Clinic A",
        redactedSummary: "Routine follow-up appointment"
    )
}

private func medicalMedication() -> MedicalMedicationDTO {
    MedicalMedicationDTO(
        id: "med-001",
        importId: "med-import-001",
        name: "Metformin",
        dosage: "500mg",
        frequency: "Twice daily",
        prescriber: "Dr. Smith",
        startDate: "2026-01-12T00:00:00Z",
        endDate: nil,
        redactedSummary: "Active medication"
    )
}

private func medicalDocument() -> MedicalDocumentDTO {
    MedicalDocumentDTO(
        id: "med-doc-001",
        importId: "med-import-001",
        fileName: "lab-results.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12_288,
        redactedSummary: "Recent lab report"
    )
}

private func medicalDigest() -> MedicalDigestDTO {
    MedicalDigestDTO(
        id: "med-digest-001",
        period: "quarter",
        appointmentCount: 1,
        activeMedications: 1,
        summary: "One upcoming appointment and one active medication.",
        generatedAt: "2026-04-03T09:40:00Z"
    )
}

private func medicalSearchResult(recordId: String = "appt-001") -> MedicalSearchResultDTO {
    MedicalSearchResultDTO(
        recordId: recordId,
        recordType: "appointment",
        date: "2026-04-11T14:00:00Z",
        redactedSummary: "Routine follow-up appointment",
        score: 0.88
    )
}

private func medicalSearchResponse(query: String) -> MedicalSearchResponseDTO {
    let payload = """
    {
      "query": "\(query)",
      "results": [
        {
          "record_id": "appt-001",
          "record_type": "appointment",
          "date": "2026-04-11T14:00:00Z",
          "redacted_summary": "Routine follow-up appointment",
          "score": 0.88
        }
      ]
    }
    """
    return decode(payload, as: MedicalSearchResponseDTO.self)
}

private func decode<T: Decodable>(_ json: String, as type: T.Type) -> T {
    do {
        return try ResponseDecoder.makeDecoder().decode(T.self, from: Data(json.utf8))
    } catch {
        fatalError("Failed to decode test fixture for \(T.self): \(error)")
    }
}
