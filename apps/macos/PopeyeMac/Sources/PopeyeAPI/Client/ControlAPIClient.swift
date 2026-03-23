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
            return try await executePost(endpoint, body: body)
        } catch APIError.csrfInvalid {
            // CSRF token expired — clear and retry once
            csrfToken = nil
            try await ensureCsrfToken()
            return try await executePost(endpoint, body: body)
        }
    }

    private func executePost<T: Decodable & Sendable>(_ endpoint: Endpoint, body: (any Encodable & Sendable)? = nil) async throws -> T {
        var request = try buildRequest(for: endpoint)
        request.httpMethod = HTTPMethod.post.rawValue

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

    // MARK: - Connections

    public func listConnections() async throws -> [ConnectionDTO] {
        try await get(.connections)
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

    public func resolveIntervention(id: String, note: String? = nil) async throws -> InterventionDTO {
        try await post(.resolveIntervention(id: id), body: InterventionResolveInput(resolutionNote: note))
    }

    public func resolveApproval(id: String, decision: String, reason: String? = nil) async throws -> ApprovalDTO {
        try await post(.resolveApproval(id: id), body: ApprovalResolveInput(decision: decision, decisionReason: reason))
    }

    // MARK: - Memory

    public func searchMemories(query: String, limit: Int = 20, scope: String? = nil, types: String? = nil, domains: String? = nil) async throws -> MemorySearchResponseDTO {
        try await get(.memorySearch(query: query, limit: limit, scope: scope, types: types, domains: domains))
    }

    public func listMemories() async throws -> [MemoryRecordDTO] {
        try await get(.memories)
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

    // MARK: - Telegram

    public func telegramRelayCheckpoint(workspaceId: String = "default") async throws -> TelegramRelayCheckpointDTO? {
        try await get(.telegramRelayCheckpoint(workspaceId: workspaceId))
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
