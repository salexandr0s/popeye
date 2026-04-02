import Foundation
import PopeyeAPI

@Observable @MainActor
final class CuratedDocumentsStore {
    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            resetState()
        }
    }

    var documents: [CuratedDocumentSummaryDTO] = []
    var selectedDocumentID: String?
    var selectedDocument: CuratedDocumentRecordDTO?
    var draftMarkdown = "" {
        didSet {
            guard draftMarkdown != oldValue else { return }
            proposal = nil
            errorMessage = nil
            saveMessage = nil
        }
    }
    var proposal: CuratedDocumentSaveProposalDTO?
    var lastSaveReceipt: MutationReceiptDTO?
    var isLoading = false
    var isSaving = false
    var errorMessage: String?
    var saveMessage: String?
    var pendingSelectionID: String?
    var showDiscardAlert = false

    private let service: CuratedDocumentsService
    private let allowedKinds: Set<String>
    private let preferredKinds: [String]

    init(
        client: ControlAPIClient,
        allowedKinds: Set<String>,
        preferredKinds: [String]
    ) {
        self.service = CuratedDocumentsService(client: client)
        self.allowedKinds = allowedKinds
        self.preferredKinds = preferredKinds
    }

    var isDirty: Bool {
        normalized(draftMarkdown) != normalized(selectedDocument?.markdownText ?? "")
    }

    var previewMarkdown: String {
        proposal?.normalizedMarkdown ?? draftMarkdown
    }

    var proposalMatchesDraft: Bool {
        proposal?.normalizedMarkdown == normalized(draftMarkdown)
    }

    var selectedDocumentPath: String? {
        selectedDocument?.filePath ?? documents.first(where: { $0.id == selectedDocumentID })?.filePath
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            let loaded = try await service.loadDocuments(workspaceId: workspaceID)
                .filter { allowedKinds.contains($0.kind) }
            documents = sortDocuments(loaded)
            let nextSelection = selectedDocumentID.flatMap { id in
                documents.contains(where: { $0.id == id }) ? id : nil
            } ?? preferredDocumentID(in: documents)
            selectedDocumentID = nextSelection
            if let nextSelection {
                await loadDocument(id: nextSelection)
            } else {
                selectedDocument = nil
                draftMarkdown = ""
                proposal = nil
            }
        } catch let apiError as APIError {
            errorMessage = apiError.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func loadIfNeeded() async {
        guard documents.isEmpty, !isLoading else { return }
        await load()
    }

    func requestSelection(_ id: String) {
        guard id != selectedDocumentID else { return }
        if isDirty {
            pendingSelectionID = id
            showDiscardAlert = true
        } else {
            Task { await loadDocument(id: id) }
        }
    }

    func confirmDiscardAndSwitch() {
        let next = pendingSelectionID
        pendingSelectionID = nil
        showDiscardAlert = false
        proposal = nil
        errorMessage = nil
        saveMessage = nil
        guard let next else { return }
        Task { await loadDocument(id: next) }
    }

    func cancelPendingSelection() {
        pendingSelectionID = nil
        showDiscardAlert = false
    }

    func discardChanges() {
        draftMarkdown = selectedDocument?.markdownText ?? ""
        proposal = nil
        errorMessage = nil
    }

    func reviewChanges() async {
        guard let selectedDocument else { return }
        isSaving = true
        errorMessage = nil
        saveMessage = nil
        do {
            proposal = try await service.proposeSave(
                id: selectedDocument.id,
                markdownText: draftMarkdown,
                baseRevisionHash: selectedDocument.revisionHash
            )
            if proposal?.status == "conflict" {
                errorMessage = proposal?.conflictMessage ?? "This document changed since it was loaded."
            }
        } catch let apiError as APIError {
            errorMessage = apiError.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }

    func applySave() async {
        guard let selectedDocument else { return }
        isSaving = true
        errorMessage = nil
        saveMessage = nil
        do {
            let result = try await service.applySave(
                id: selectedDocument.id,
                markdownText: proposal?.normalizedMarkdown ?? draftMarkdown,
                baseRevisionHash: selectedDocument.revisionHash,
                confirmedCriticalWrite: selectedDocument.critical
            )
            self.selectedDocument = result.document
            selectedDocumentID = result.document.id
            lastSaveReceipt = result.receipt
            draftMarkdown = result.document.markdownText
            proposal = nil
            saveMessage = "Saved \(result.document.title)."
            await refreshListMetadata(after: result.document)
        } catch let apiError as APIError {
            errorMessage = apiError.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }

    private func loadDocument(id: String) async {
        do {
            let document = try await service.loadDocument(id: id)
            selectedDocumentID = id
            selectedDocument = document
            draftMarkdown = document.markdownText
            proposal = nil
            errorMessage = nil
        } catch let apiError as APIError {
            errorMessage = apiError.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func refreshListMetadata(after document: CuratedDocumentRecordDTO) async {
        do {
            let loaded = try await service.loadDocuments(workspaceId: workspaceID)
                .filter { allowedKinds.contains($0.kind) }
            documents = sortDocuments(loaded)
            if documents.contains(where: { $0.id == document.id }) == false {
                documents.insert(
                    CuratedDocumentSummaryDTO(
                        id: document.id,
                        kind: document.kind,
                        workspaceId: document.workspaceId,
                        projectId: document.projectId,
                        title: document.title,
                        subtitle: document.subtitle,
                        filePath: document.filePath,
                        writable: document.writable,
                        critical: document.critical,
                        exists: document.exists,
                        updatedAt: document.updatedAt
                    ),
                    at: 0
                )
            }
        } catch {
            // Keep the saved document loaded locally; metadata refresh can lag safely.
        }
    }

    private func preferredDocumentID(in summaries: [CuratedDocumentSummaryDTO]) -> String? {
        for kind in preferredKinds {
            if let match = summaries.first(where: { $0.kind == kind }) {
                return match.id
            }
        }
        return summaries.first?.id
    }

    private func sortDocuments(_ summaries: [CuratedDocumentSummaryDTO]) -> [CuratedDocumentSummaryDTO] {
        summaries.sorted { lhs, rhs in
            let lhsIndex = preferredKinds.firstIndex(of: lhs.kind) ?? .max
            let rhsIndex = preferredKinds.firstIndex(of: rhs.kind) ?? .max
            if lhsIndex != rhsIndex { return lhsIndex < rhsIndex }
            if lhs.kind == "daily_memory_note", rhs.kind == "daily_memory_note" {
                return lhs.title > rhs.title
            }
            if lhs.exists != rhs.exists { return lhs.exists && !rhs.exists }
            return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
        }
    }

    private func resetState() {
        documents = []
        selectedDocumentID = nil
        selectedDocument = nil
        draftMarkdown = ""
        proposal = nil
        lastSaveReceipt = nil
        errorMessage = nil
        saveMessage = nil
        pendingSelectionID = nil
        showDiscardAlert = false
    }

    private func normalized(_ markdown: String) -> String {
        let replaced = markdown.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        return replaced.hasSuffix("\n") || replaced.isEmpty ? replaced : "\(replaced)\n"
    }
}
