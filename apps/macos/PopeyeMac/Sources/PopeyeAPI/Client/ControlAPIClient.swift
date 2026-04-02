import Foundation

public actor ControlAPIClient {
    private let baseURL: String
    private let token: String
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private var csrfToken: String?

    public init(baseURL: String, token: String, session: URLSession = .shared) {
        self.baseURL = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL
        self.token = token
        self.session = session
        self.decoder = ResponseDecoder.makeDecoder()
        self.encoder = JSONEncoder()
    }

    // MARK: - Public API

    public func get<T: Decodable & Sendable>(_ endpoint: Endpoint) async throws -> T {
        let request = try buildRequest(for: endpoint)
        return try await execute(request)
    }

    public func post<T: Decodable & Sendable>(_ endpoint: Endpoint, body: (any Encodable & Sendable)? = nil) async throws -> T {
        try await ensureCsrfToken()

        do {
            return try await executeMutation(endpoint, method: .post, body: body)
        } catch APIError.csrfInvalid {
            // CSRF token expired — clear and retry once
            csrfToken = nil
            try await ensureCsrfToken()
            return try await executeMutation(endpoint, method: .post, body: body)
        }
    }

    public func patch<T: Decodable & Sendable>(_ endpoint: Endpoint, body: (any Encodable & Sendable)? = nil) async throws -> T {
        try await ensureCsrfToken()

        do {
            return try await executeMutation(endpoint, method: .patch, body: body)
        } catch APIError.csrfInvalid {
            csrfToken = nil
            try await ensureCsrfToken()
            return try await executeMutation(endpoint, method: .patch, body: body)
        }
    }

    public func delete<T: Decodable & Sendable>(_ endpoint: Endpoint, body: (any Encodable & Sendable)? = nil) async throws -> T {
        try await ensureCsrfToken()

        do {
            return try await executeMutation(endpoint, method: .delete, body: body)
        } catch APIError.csrfInvalid {
            csrfToken = nil
            try await ensureCsrfToken()
            return try await executeMutation(endpoint, method: .delete, body: body)
        }
    }

    private func executeMutation<T: Decodable & Sendable>(
        _ endpoint: Endpoint,
        method: HTTPMethod,
        body: (any Encodable & Sendable)? = nil
    ) async throws -> T {
        var request = try buildRequest(for: endpoint)
        request.httpMethod = method.rawValue

        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        if let csrf = csrfToken {
            request.setValue(csrf, forHTTPHeaderField: "x-popeye-csrf")
        }

        return try await execute(request)
    }

    // MARK: - Convenience Methods

    public func health() async throws -> HealthDTO {
        try await get(.health)
    }

    public func status() async throws -> DaemonStatusDTO {
        try await get(.status)
    }

    public func homeSummary(workspaceId: String) async throws -> HomeSummaryDTO {
        try await get(.homeSummary(workspaceId: workspaceId))
    }

    public func schedulerStatus() async throws -> SchedulerStatusDTO {
        try await get(.schedulerStatus)
    }

    public func engineCapabilities() async throws -> EngineCapabilitiesDTO {
        try await get(.engineCapabilities)
    }

    public func usageSummary() async throws -> UsageSummaryDTO {
        try await get(.usageSummary)
    }

    public func securityAudit() async throws -> SecurityAuditDTO {
        try await get(.securityAudit)
    }

    public func listWorkspaces() async throws -> [WorkspaceRecordDTO] {
        try await get(.workspaces)
    }

    public func listVaults(domain: String? = nil) async throws -> [VaultRecordDTO] {
        try await get(.vaults(domain: domain))
    }

    public func listAutomations(workspaceId: String? = nil) async throws -> [AutomationRecordDTO] {
        try await get(.automations(workspaceId: workspaceId))
    }

    public func getAutomation(id: String) async throws -> AutomationDetailDTO {
        try await get(.automation(id: id))
    }

    public func updateAutomation(id: String, input: AutomationUpdateInput) async throws -> AutomationDetailDTO {
        try await patch(.updateAutomation(id: id), body: input)
    }

    // MARK: - Execution

    public func listTasks() async throws -> [TaskRecordDTO] {
        try await get(.tasks)
    }

    public func listRuns() async throws -> [RunRecordDTO] {
        try await get(.runs)
    }

    public func getRun(id: String) async throws -> RunRecordDTO {
        try await get(.run(id: id))
    }

    public func getRunEnvelope(id: String) async throws -> ExecutionEnvelopeDTO {
        try await get(.runEnvelope(id: id))
    }

    public func getRunEvents(id: String) async throws -> [RunEventDTO] {
        try await get(.runEvents(id: id))
    }

    public func getRunReply(id: String) async throws -> RunReplyDTO {
        try await get(.runReply(id: id))
    }

    public func getRunReceipt(runId: String) async throws -> ReceiptRecordDTO {
        try await get(.runReceipt(id: runId))
    }

    public func listJobs() async throws -> [JobRecordDTO] {
        try await get(.jobs)
    }

    public func getJob(id: String) async throws -> JobRecordDTO {
        try await get(.job(id: id))
    }

    public func getJobLease(id: String) async throws -> JobLeaseDTO {
        try await get(.jobLease(id: id))
    }

    public func listReceipts() async throws -> [ReceiptRecordDTO] {
        try await get(.receipts)
    }

    public func getReceipt(id: String) async throws -> ReceiptRecordDTO {
        try await get(.receipt(id: id))
    }

    // MARK: - Governance

    public func listInterventions() async throws -> [InterventionDTO] {
        try await get(.interventions)
    }

    public func listApprovals() async throws -> [ApprovalDTO] {
        try await get(.approvals)
    }

    public func createApproval(input: ApprovalRequestInput) async throws -> ApprovalDTO {
        try await post(.createApproval, body: input)
    }

    // MARK: - Connections

    public func listConnections() async throws -> [ConnectionDTO] {
        try await get(.connections)
    }

    public func startOAuthConnection(input: OAuthConnectStartInput) async throws -> OAuthSessionDTO {
        try await post(.startOAuthConnection, body: input)
    }

    public func getOAuthConnectionSession(id: String) async throws -> OAuthSessionDTO {
        try await get(.oauthConnectionSession(id: id))
    }

    // MARK: - Identities

    public func listIdentities(workspaceId: String) async throws -> [IdentityRecordDTO] {
        try await get(.identities(workspaceId: workspaceId))
    }

    public func getDefaultIdentity(workspaceId: String) async throws -> WorkspaceIdentityDefaultDTO {
        try await get(.defaultIdentity(workspaceId: workspaceId))
    }

    // MARK: - Mutations

    public func retryRun(id: String) async throws -> RunRecordDTO {
        try await post(.retryRun(id: id))
    }

    public func cancelRun(id: String) async throws -> RunRecordDTO {
        try await post(.cancelRun(id: id))
    }

    public func pauseJob(id: String) async throws -> JobRecordDTO {
        try await post(.pauseJob(id: id))
    }

    public func resumeJob(id: String) async throws -> JobRecordDTO {
        try await post(.resumeJob(id: id))
    }

    public func enqueueJob(id: String) async throws -> JobRecordDTO {
        try await post(.enqueueJob(id: id))
    }

    public func runAutomationNow(id: String) async throws -> AutomationDetailDTO {
        try await post(.runAutomationNow(id: id))
    }

    public func pauseAutomation(id: String) async throws -> AutomationDetailDTO {
        try await post(.pauseAutomation(id: id))
    }

    public func resumeAutomation(id: String) async throws -> AutomationDetailDTO {
        try await post(.resumeAutomation(id: id))
    }

    public func resolveIntervention(id: String, note: String? = nil) async throws -> InterventionDTO {
        try await post(.resolveIntervention(id: id), body: InterventionResolveInput(resolutionNote: note))
    }

    public func resolveApproval(id: String, decision: String, reason: String? = nil) async throws -> ApprovalDTO {
        try await post(.resolveApproval(id: id), body: ApprovalResolveInput(decision: decision, decisionReason: reason))
    }

    public func storeSecret(input: StoreSecretInput) async throws -> SecretRefDTO {
        try await post(.storeSecret, body: input)
    }

    public func telegramConfig() async throws -> TelegramConfigSnapshotDTO {
        try await get(.telegramConfig)
    }

    public func saveTelegramConfig(input: TelegramConfigUpdateInput) async throws -> TelegramConfigSnapshotDTO {
        try await post(.saveTelegramConfig, body: input)
    }

    public func applyTelegramConfig() async throws -> TelegramApplyResponseDTO {
        try await post(.applyTelegramConfig)
    }

    public func restartDaemon() async throws -> DaemonRestartResponseDTO {
        try await post(.restartDaemon)
    }

    public func openVault(id: String, approvalId: String) async throws -> VaultRecordDTO {
        try await post(.openVault(id: id), body: VaultOpenInput(approvalId: approvalId))
    }

    public func closeVault(id: String) async throws -> VaultRecordDTO {
        try await post(.closeVault(id: id))
    }

    public func listMutationReceipts(component: String? = nil, limit: Int = 10) async throws -> [MutationReceiptDTO] {
        try await get(.mutationReceipts(component: component, limit: limit))
    }

    // MARK: - Memory

    public func searchMemories(query: String, limit: Int = 20, scope: String? = nil, workspaceId: String? = nil, types: String? = nil, domains: String? = nil) async throws -> MemorySearchResponseDTO {
        try await get(.memorySearch(query: query, limit: limit, scope: scope, workspaceId: workspaceId, types: types, domains: domains))
    }

    public func listMemories(
        type: String? = nil,
        scope: String? = nil,
        workspaceId: String? = nil,
        projectId: String? = nil,
        includeGlobal: Bool? = nil,
        limit: Int? = nil
    ) async throws -> [MemoryRecordDTO] {
        try await get(.memories(
            type: type,
            scope: scope,
            workspaceId: workspaceId,
            projectId: projectId,
            includeGlobal: includeGlobal,
            limit: limit
        ))
    }

    public func getMemory(id: String) async throws -> MemoryRecordDTO {
        try await get(.memory(id: id))
    }

    public func getMemoryHistory(id: String) async throws -> MemoryHistoryDTO {
        try await get(.memoryHistory(id: id))
    }

    public func memoryAudit() async throws -> MemoryAuditDTO {
        try await get(.memoryAudit)
    }

    public func pinMemory(id: String, targetKind: String, reason: String? = nil) async throws -> MemoryRecordDTO {
        try await post(.memoryPin(id: id), body: MemoryPinInput(targetKind: targetKind, reason: reason))
    }

    public func forgetMemory(id: String, reason: String? = nil) async throws -> MemoryRecordDTO {
        try await post(.memoryForget(id: id), body: MemoryForgetInput(reason: reason))
    }

    public func proposePromotion(id: String, targetPath: String) async throws -> MemoryPromotionProposalDTO {
        try await post(.memoryPromotePropose(id: id), body: MemoryPromotionProposeInput(targetPath: targetPath))
    }

    public func executePromotion(id: String, input: MemoryPromotionExecuteInput) async throws -> MemoryPromotionProposalDTO {
        try await post(.memoryPromoteExecute(id: id), body: input)
    }

    public func triggerMemoryMaintenance() async throws -> EmptyResponseDTO {
        try await post(.memoryMaintenance)
    }

    // MARK: - Agent Profiles

    public func listAgentProfiles() async throws -> [AgentProfileDTO] {
        try await get(.agentProfiles)
    }

    public func getAgentProfile(id: String) async throws -> AgentProfileDTO {
        try await get(.agentProfile(id: id))
    }

    // MARK: - Instruction Previews

    public func instructionPreview(scope: String) async throws -> InstructionPreviewDTO {
        try await get(.instructionPreview(scope: scope))
    }

    public func listCuratedDocuments(workspaceId: String) async throws -> [CuratedDocumentSummaryDTO] {
        try await get(.curatedDocuments(workspaceId: workspaceId))
    }

    public func getCuratedDocument(id: String) async throws -> CuratedDocumentRecordDTO {
        try await get(.curatedDocument(id: id))
    }

    public func proposeCuratedDocumentSave(id: String, input: CuratedDocumentProposeSaveInput) async throws -> CuratedDocumentSaveProposalDTO {
        try await post(.proposeCuratedDocumentSave(id: id), body: input)
    }

    public func applyCuratedDocumentSave(id: String, input: CuratedDocumentApplySaveInput) async throws -> CuratedDocumentApplyResultDTO {
        try await post(.applyCuratedDocumentSave(id: id), body: input)
    }

    public func listEmailAccounts() async throws -> [EmailAccountDTO] {
        try await get(.emailAccounts)
    }

    public func listEmailThreads(accountId: String, limit: Int = 50, unreadOnly: Bool = false) async throws -> [EmailThreadDTO] {
        try await get(.emailThreads(accountId: accountId, limit: limit, unreadOnly: unreadOnly))
    }

    public func getEmailThread(id: String) async throws -> EmailThreadDTO {
        try await get(.emailThread(id: id))
    }

    public func emailDigest(accountId: String) async throws -> EmailDigestDTO? {
        try? await get(.emailDigest(accountId: accountId))
    }

    public func listCalendarAccounts() async throws -> [CalendarAccountDTO] {
        try await get(.calendarAccounts)
    }

    public func listCalendarEvents(accountId: String, dateFrom: String? = nil, dateTo: String? = nil, limit: Int = 80) async throws -> [CalendarEventDTO] {
        try await get(.calendarEvents(accountId: accountId, dateFrom: dateFrom, dateTo: dateTo, limit: limit))
    }

    public func getCalendarEvent(id: String) async throws -> CalendarEventDTO {
        try await get(.calendarEvent(id: id))
    }

    public func calendarDigest(accountId: String) async throws -> CalendarDigestDTO? {
        try? await get(.calendarDigest(accountId: accountId))
    }

    public func listTodoAccounts() async throws -> [TodoAccountDTO] {
        try await get(.todoAccounts)
    }

    public func listTodoItems(accountId: String, project: String? = nil, limit: Int = 100) async throws -> [TodoItemDTO] {
        try await get(.todoItems(accountId: accountId, project: project, limit: limit))
    }

    public func getTodoItem(id: String) async throws -> TodoItemDTO {
        try await get(.todoItem(id: id))
    }

    public func listTodoProjects(accountId: String) async throws -> [TodoProjectDTO] {
        try await get(.todoProjects(accountId: accountId))
    }

    public func todoDigest(accountId: String) async throws -> TodoDigestDTO? {
        try? await get(.todoDigest(accountId: accountId))
    }

    public func listPeople() async throws -> [PersonDTO] {
        try await get(.people)
    }

    public func searchPeople(query: String, limit: Int = 20) async throws -> PersonSearchResponseDTO {
        try await get(.peopleSearch(query: query, limit: limit))
    }

    public func getPerson(id: String) async throws -> PersonDTO {
        try await get(.person(id: id))
    }

    public func listPersonMergeEvents(id: String) async throws -> [PersonMergeEventDTO] {
        try await get(.personMergeEvents(id: id))
    }

    public func listPersonMergeSuggestions() async throws -> [PersonMergeSuggestionDTO] {
        try await get(.personMergeSuggestions)
    }

    public func listPersonActivity(id: String) async throws -> [PersonActivityRollupDTO] {
        try await get(.personActivity(id: id))
    }

    public func mergePeople(input: PersonMergeInput) async throws -> PersonDTO {
        try await post(.mergePeople, body: input)
    }

    public func splitPerson(id: String, input: PersonSplitInput) async throws -> PersonDTO {
        try await post(.splitPerson(id: id), body: input)
    }

    public func attachPersonIdentity(input: PersonIdentityAttachInput) async throws -> PersonDTO {
        try await post(.attachPersonIdentity, body: input)
    }

    public func detachPersonIdentity(id: String, input: PersonIdentityDetachInput = PersonIdentityDetachInput()) async throws -> PersonDTO {
        try await post(.detachPersonIdentity(id: id), body: input)
    }

    public func listFileRoots(workspaceId: String? = nil) async throws -> [FileRootDTO] {
        try await get(.fileRoots(workspaceId: workspaceId))
    }

    public func getFileRoot(id: String) async throws -> FileRootDTO {
        try await get(.fileRoot(id: id))
    }

    public func searchFiles(query: String, rootId: String? = nil, workspaceId: String? = nil, limit: Int = 10) async throws -> FileSearchResponseDTO {
        try await get(.fileSearch(query: query, rootId: rootId, workspaceId: workspaceId, limit: limit))
    }

    public func getFileDocument(id: String) async throws -> FileDocumentDTO {
        try await get(.fileDocument(id: id))
    }

    public func listFileWriteIntents(rootId: String? = nil, status: String? = nil) async throws -> [FileWriteIntentDTO] {
        try await get(.fileWriteIntents(rootId: rootId, status: status))
    }

    public func getFileWriteIntent(id: String) async throws -> FileWriteIntentDTO {
        try await get(.fileWriteIntent(id: id))
    }

    public func createFileRoot(input: FileRootRegistrationInput) async throws -> FileRootDTO {
        try await post(.createFileRoot, body: input)
    }

    public func updateFileRoot(id: String, input: FileRootUpdateInput) async throws -> FileRootDTO {
        try await patch(.updateFileRoot(id: id), body: input)
    }

    public func deleteFileRoot(id: String) async throws -> EmptyResponseDTO {
        try await delete(.deleteFileRoot(id: id))
    }

    public func reindexFileRoot(id: String) async throws -> FileIndexResultDTO {
        try await post(.reindexFileRoot(id: id))
    }

    public func reviewFileWriteIntent(id: String, input: FileWriteIntentReviewInput) async throws -> FileWriteIntentDTO {
        try await post(.reviewFileWriteIntent(id: id), body: input)
    }

    public func listFinanceImports() async throws -> [FinanceImportDTO] {
        try await get(.financeImports)
    }

    public func getFinanceImport(id: String) async throws -> FinanceImportDTO {
        try await get(.financeImport(id: id))
    }

    public func listFinanceTransactions(importId: String? = nil, category: String? = nil, dateFrom: String? = nil, dateTo: String? = nil, limit: Int? = nil) async throws -> [FinanceTransactionDTO] {
        try await get(.financeTransactions(importId: importId, category: category, dateFrom: dateFrom, dateTo: dateTo, limit: limit))
    }

    public func listFinanceDocuments(importId: String? = nil) async throws -> [FinanceDocumentDTO] {
        try await get(.financeDocuments(importId: importId))
    }

    public func searchFinance(query: String, category: String? = nil, dateFrom: String? = nil, dateTo: String? = nil, limit: Int = 20) async throws -> FinanceSearchResponseDTO {
        try await get(.financeSearch(query: query, category: category, dateFrom: dateFrom, dateTo: dateTo, limit: limit))
    }

    public func financeDigest(period: String? = nil) async throws -> FinanceDigestDTO? {
        try? await get(.financeDigest(period: period))
    }

    public func triggerFinanceDigest(period: String? = nil) async throws -> FinanceDigestDTO {
        try await post(.triggerFinanceDigest, body: FinanceDigestTriggerInput(period: period))
    }

    public func createFinanceImport(input: FinanceImportCreateInput) async throws -> FinanceImportDTO {
        try await post(.createFinanceImport, body: input)
    }

    public func createFinanceTransaction(input: FinanceTransactionCreateInput) async throws -> FinanceTransactionDTO {
        try await post(.createFinanceTransaction, body: input)
    }

    public func updateFinanceImportStatus(id: String, input: FinanceImportStatusUpdateInput) async throws -> EmptyResponseDTO {
        try await post(.updateFinanceImportStatus(id: id), body: input)
    }

    public func listMedicalImports() async throws -> [MedicalImportDTO] {
        try await get(.medicalImports)
    }

    public func getMedicalImport(id: String) async throws -> MedicalImportDTO {
        try await get(.medicalImport(id: id))
    }

    public func listMedicalAppointments(importId: String? = nil, limit: Int? = nil) async throws -> [MedicalAppointmentDTO] {
        try await get(.medicalAppointments(importId: importId, limit: limit))
    }

    public func listMedicalMedications(importId: String? = nil) async throws -> [MedicalMedicationDTO] {
        try await get(.medicalMedications(importId: importId))
    }

    public func listMedicalDocuments(importId: String? = nil) async throws -> [MedicalDocumentDTO] {
        try await get(.medicalDocuments(importId: importId))
    }

    public func searchMedical(query: String, limit: Int = 20) async throws -> MedicalSearchResponseDTO {
        try await get(.medicalSearch(query: query, limit: limit))
    }

    public func medicalDigest(period: String? = nil) async throws -> MedicalDigestDTO? {
        try? await get(.medicalDigest(period: period))
    }

    public func triggerMedicalDigest(period: String? = nil) async throws -> MedicalDigestDTO {
        try await post(.triggerMedicalDigest, body: MedicalDigestTriggerInput(period: period))
    }

    public func createMedicalImport(input: MedicalImportCreateInput) async throws -> MedicalImportDTO {
        try await post(.createMedicalImport, body: input)
    }

    public func createMedicalAppointment(input: MedicalAppointmentCreateInput) async throws -> MedicalAppointmentDTO {
        try await post(.createMedicalAppointment, body: input)
    }

    public func createMedicalMedication(input: MedicalMedicationCreateInput) async throws -> MedicalMedicationDTO {
        try await post(.createMedicalMedication, body: input)
    }

    public func createMedicalDocument(input: MedicalDocumentCreateInput) async throws -> MedicalDocumentDTO {
        try await post(.createMedicalDocument, body: input)
    }

    public func updateMedicalImportStatus(id: String, input: MedicalImportStatusUpdateInput) async throws -> EmptyResponseDTO {
        try await post(.updateMedicalImportStatus(id: id), body: input)
    }

    // MARK: - Telegram

    public func telegramRelayCheckpoint(workspaceId: String = "default") async throws -> TelegramRelayCheckpointDTO? {
        do {
            return try await get(.telegramRelayCheckpoint(workspaceId: workspaceId))
        } catch APIError.notFound {
            return nil
        }
    }

    public func listUncertainDeliveries(workspaceId: String = "default") async throws -> [TelegramDeliveryDTO] {
        try await get(.telegramUncertainDeliveries(workspaceId: workspaceId))
    }

    public func getTelegramDelivery(id: String) async throws -> TelegramDeliveryDTO {
        try await get(.telegramDelivery(id: id))
    }

    public func listDeliveryResolutions(id: String) async throws -> [TelegramResolutionDTO] {
        try await get(.telegramDeliveryResolutions(id: id))
    }

    public func listDeliverySendAttempts(id: String) async throws -> [TelegramSendAttemptDTO] {
        try await get(.telegramDeliveryAttempts(id: id))
    }

    public func resolveTelegramDelivery(id: String, input: TelegramDeliveryResolveInput) async throws -> TelegramResolutionDTO {
        try await post(.telegramResolveDelivery(id: id), body: input)
    }

    // MARK: - SSE Stream

    public func eventStreamBytes() async throws -> (URLSession.AsyncBytes, URLResponse) {
        let request = try buildRequest(for: .eventStream)
        return try await session.bytes(for: request)
    }

    // MARK: - Private

    private func buildRequest(for endpoint: Endpoint) throws -> URLRequest {
        guard var components = URLComponents(string: baseURL + endpoint.path) else {
            throw APIError.transportUnavailable
        }

        if !endpoint.queryItems.isEmpty {
            components.queryItems = endpoint.queryItems
        }

        guard let url = components.url else {
            throw APIError.transportUnavailable
        }

        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 30

        return request
    }

    private func execute<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transportUnavailable
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.transportUnavailable
        }

        switch httpResponse.statusCode {
        case 200..<300:
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw APIError.decodeFailure(message: error.localizedDescription)
            }
        case 401:
            throw APIError.unauthorized
        case 403:
            // Check if CSRF-related
            if let body = try? decoder.decode(ErrorResponseDTO.self, from: data),
               body.error.lowercased().contains("csrf") {
                csrfToken = nil
                throw APIError.csrfInvalid
            }
            throw APIError.forbidden
        case 404:
            throw APIError.notFound
        default:
            let message = (try? decoder.decode(ErrorResponseDTO.self, from: data))?.error
                ?? "Unknown error"
            throw APIError.apiFailure(statusCode: httpResponse.statusCode, message: message)
        }
    }

    private func ensureCsrfToken() async throws {
        if csrfToken != nil { return }
        let response: CsrfTokenDTO = try await get(.csrfToken)
        csrfToken = response.token
    }
}

struct ErrorResponseDTO: Decodable, Sendable {
    let error: String
}

public struct EmptyResponseDTO: Decodable, Sendable {}
