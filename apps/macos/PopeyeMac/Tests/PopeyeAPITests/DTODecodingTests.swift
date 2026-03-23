import Testing
import Foundation
@testable import PopeyeAPI

@Suite("DTO Decoding")
struct DTODecodingTests {
    let decoder = ResponseDecoder.makeDecoder()

    private func loadFixture(_ name: String) throws -> Data {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json") else {
            throw FixtureError.notFound(name)
        }
        return try Data(contentsOf: url)
    }

    enum FixtureError: Error {
        case notFound(String)
    }

    @Test("Decode HealthDTO from fixture")
    func decodeHealth() throws {
        let data = try loadFixture("health")
        let dto = try decoder.decode(HealthDTO.self, from: data)

        #expect(dto.ok == true)
        #expect(dto.startedAt.isEmpty == false)
    }

    @Test("Decode DaemonStatusDTO from fixture")
    func decodeDaemonStatus() throws {
        let data = try loadFixture("daemon_status")
        let dto = try decoder.decode(DaemonStatusDTO.self, from: data)

        #expect(dto.ok == true)
        #expect(dto.runningJobs == 2)
        #expect(dto.queuedJobs == 1)
        #expect(dto.openInterventions == 0)
        #expect(dto.activeLeases == 2)
        #expect(dto.engineKind == "pi")
        #expect(dto.schedulerRunning == true)
        #expect(dto.lastShutdownAt == nil)
    }

    @Test("Decode SchedulerStatusDTO from fixture")
    func decodeSchedulerStatus() throws {
        let data = try loadFixture("scheduler_status")
        let dto = try decoder.decode(SchedulerStatusDTO.self, from: data)

        #expect(dto.running == true)
        #expect(dto.activeLeases == 2)
        #expect(dto.activeRuns == 1)
        #expect(dto.nextHeartbeatDueAt != nil)
    }

    @Test("Decode EngineCapabilitiesDTO from fixture")
    func decodeEngineCapabilities() throws {
        let data = try loadFixture("engine_capabilities")
        let dto = try decoder.decode(EngineCapabilitiesDTO.self, from: data)

        #expect(dto.engineKind == "pi")
        #expect(dto.persistentSessionSupport == true)
        #expect(dto.hostToolMode == "native")
        #expect(dto.compactionEventSupport == true)
        #expect(dto.cancellationMode == "rpc_abort")
        #expect(dto.warnings.isEmpty)
    }

    @Test("Decode UsageSummaryDTO from fixture")
    func decodeUsageSummary() throws {
        let data = try loadFixture("usage_summary")
        let dto = try decoder.decode(UsageSummaryDTO.self, from: data)

        #expect(dto.runs == 42)
        #expect(dto.tokensIn == 150_000)
        #expect(dto.tokensOut == 80_000)
        #expect(dto.estimatedCostUsd == 3.45)
    }

    @Test("Decode SecurityAuditDTO from fixture")
    func decodeSecurityAudit() throws {
        let data = try loadFixture("security_audit")
        let dto = try decoder.decode(SecurityAuditDTO.self, from: data)

        #expect(dto.findings.count == 2)
        #expect(dto.findings[0].severity == "info")
        #expect(dto.findings[1].severity == "warn")
        #expect(dto.findings[1].details?["recommendation"] != nil)
    }

    // MARK: - Execution DTOs

    @Test("Decode RunRecordDTO from fixture")
    func decodeRunRecord() throws {
        let data = try loadFixture("run_record")
        let dto = try decoder.decode(RunRecordDTO.self, from: data)

        #expect(dto.id == "run-abc123")
        #expect(dto.jobId == "job-def456")
        #expect(dto.taskId == "task-ghi789")
        #expect(dto.workspaceId == "ws-main")
        #expect(dto.profileId == "profile-default")
        #expect(dto.sessionRootId == "sess-root-001")
        #expect(dto.engineSessionRef == "pi-sess-ref-42")
        #expect(dto.state == "running")
        #expect(dto.startedAt.isEmpty == false)
        #expect(dto.finishedAt == nil)
        #expect(dto.error == nil)
    }

    @Test("Decode JobRecordDTO from fixture")
    func decodeJobRecord() throws {
        let data = try loadFixture("job_record")
        let dto = try decoder.decode(JobRecordDTO.self, from: data)

        #expect(dto.id == "job-def456")
        #expect(dto.taskId == "task-ghi789")
        #expect(dto.workspaceId == "ws-main")
        #expect(dto.status == "running")
        #expect(dto.retryCount == 1)
        #expect(dto.lastRunId == "run-abc123")
        #expect(dto.createdAt.isEmpty == false)
        #expect(dto.updatedAt.isEmpty == false)
    }

    @Test("Decode ReceiptRecordDTO from fixture with runtime section")
    func decodeReceiptRecord() throws {
        let data = try loadFixture("receipt_record")
        let dto = try decoder.decode(ReceiptRecordDTO.self, from: data)

        #expect(dto.id == "rcpt-001")
        #expect(dto.runId == "run-abc123")
        #expect(dto.status == "succeeded")
        #expect(dto.summary == "Completed code review task")

        // Usage
        #expect(dto.usage.provider == "anthropic")
        #expect(dto.usage.tokensIn == 12000)
        #expect(dto.usage.tokensOut == 4500)
        #expect(dto.usage.estimatedCostUsd == 0.087)

        // Runtime
        let runtime = try #require(dto.runtime)
        #expect(runtime.projectId == "proj-popeye")
        #expect(runtime.profileId == "profile-default")

        // Runtime - execution
        let execution = try #require(runtime.execution)
        #expect(execution.mode == "interactive")
        #expect(execution.sessionPolicy == "dedicated")
        #expect(execution.memoryScope == "workspace")
        #expect(execution.warnings.isEmpty)

        // Runtime - context releases
        let releases = try #require(runtime.contextReleases)
        #expect(releases.totalReleases == 2)
        #expect(releases.totalTokenEstimate == 8500)
        #expect(releases.byDomain["memory"]?.count == 1)
        #expect(releases.byDomain["files"]?.tokens == 5000)

        // Runtime - timeline
        let timeline = try #require(runtime.timeline)
        #expect(timeline.count == 2)
        #expect(timeline[0].kind == "run")
        #expect(timeline[1].kind == "context_release")
    }

    @Test("Decode ExecutionEnvelopeDTO from fixture")
    func decodeExecutionEnvelope() throws {
        let data = try loadFixture("execution_envelope")
        let dto = try decoder.decode(ExecutionEnvelopeDTO.self, from: data)

        #expect(dto.runId == "run-abc123")
        #expect(dto.taskId == "task-ghi789")
        #expect(dto.profileId == "profile-default")
        #expect(dto.workspaceId == "ws-main")
        #expect(dto.projectId == "proj-popeye")
        #expect(dto.mode == "interactive")
        #expect(dto.allowedRuntimeTools.count == 3)
        #expect(dto.allowedCapabilityIds.count == 2)
        #expect(dto.memoryScope == "workspace")
        #expect(dto.filesystemPolicyClass == "workspace")
        #expect(dto.contextReleasePolicy == "summary_only")
        #expect(dto.readRoots.isEmpty == false)
        #expect(dto.writeRoots.isEmpty == false)
        #expect(dto.protectedPaths.contains(".env"))
        #expect(dto.scratchRoot.isEmpty == false)
        #expect(dto.cwd != nil)

        // Provenance
        #expect(dto.provenance.engineKind == "pi")
        #expect(dto.provenance.sessionPolicy == "dedicated")
        #expect(dto.provenance.warnings.isEmpty)
    }

    // MARK: - Governance DTOs

    @Test("Decode InterventionDTO from fixture")
    func decodeIntervention() throws {
        let data = try loadFixture("intervention")
        let dto = try decoder.decode(InterventionDTO.self, from: data)

        #expect(dto.id == "intv-001")
        #expect(dto.code == "needs_credentials")
        #expect(dto.runId == "run-abc123")
        #expect(dto.status == "open")
        #expect(dto.reason.isEmpty == false)
        #expect(dto.createdAt.isEmpty == false)
        #expect(dto.resolvedAt == nil)
        #expect(dto.resolutionNote == nil)
    }

    @Test("Decode ApprovalDTO from fixture")
    func decodeApproval() throws {
        let data = try loadFixture("approval")
        let dto = try decoder.decode(ApprovalDTO.self, from: data)

        #expect(dto.id == "appr-001")
        #expect(dto.scope == "secret_access")
        #expect(dto.domain == "github")
        #expect(dto.riskClass == "ask")
        #expect(dto.actionKind == "read")
        #expect(dto.resourceScope == "workspace")
        #expect(dto.resourceType == "api_token")
        #expect(dto.requestedBy == "run-abc123")
        #expect(dto.runId == "run-abc123")
        #expect(dto.standingApprovalEligible == true)
        #expect(dto.automationGrantEligible == false)
        #expect(dto.interventionId == "intv-001")
        #expect(dto.status == "pending")
        #expect(dto.resolvedBy == nil)
        #expect(dto.expiresAt != nil)
        #expect(dto.createdAt.isEmpty == false)
        #expect(dto.resolvedAt == nil)
    }

    // MARK: - Memory DTOs

    @Test("Decode MemoryRecordDTO from fixture")
    func decodeMemoryRecord() throws {
        let data = try loadFixture("memory_record")
        let dto = try decoder.decode(MemoryRecordDTO.self, from: data)

        #expect(dto.id == "mem-001")
        #expect(dto.description == "User prefers concise commit messages")
        #expect(dto.memoryType == "semantic")
        #expect(dto.classification == "embeddable")
        #expect(dto.sourceType == "receipt")
        #expect(dto.confidence == 0.85)
        #expect(dto.scope == "workspace")
        #expect(dto.workspaceId == "ws-default")
        #expect(dto.projectId == nil)
        #expect(dto.sourceRunId == "run-abc123")
        #expect(dto.durable == false)
        #expect(dto.domain == "coding")
        #expect(dto.archivedAt == nil)
        #expect(dto.lastReinforcedAt != nil)
    }

    @Test("Decode MemorySearchResponseDTO from fixture")
    func decodeMemorySearchResponse() throws {
        let data = try loadFixture("memory_search_response")
        let dto = try decoder.decode(MemorySearchResponseDTO.self, from: data)

        #expect(dto.query == "commit preferences")
        #expect(dto.totalCandidates == 5)
        #expect(dto.latencyMs == 42.5)
        #expect(dto.searchMode == "hybrid")
        #expect(dto.strategy == "factual")
        #expect(dto.results.count == 1)

        let hit = dto.results[0]
        #expect(hit.id == "mem-001")
        #expect(hit.type == "semantic")
        #expect(hit.score == 0.91)
        #expect(hit.effectiveConfidence == 0.82)
        #expect(hit.layer == "fact")
        #expect(hit.scoreBreakdown.relevance == 0.9)
        #expect(hit.scoreBreakdown.scopeMatch == 1.0)
    }

    @Test("Decode MemoryAuditDTO from fixture")
    func decodeMemoryAudit() throws {
        let data = try loadFixture("memory_audit")
        let dto = try decoder.decode(MemoryAuditDTO.self, from: data)

        #expect(dto.totalMemories == 142)
        #expect(dto.activeMemories == 120)
        #expect(dto.archivedMemories == 22)
        #expect(dto.byType["episodic"] == 80)
        #expect(dto.byType["semantic"] == 45)
        #expect(dto.averageConfidence == 0.72)
        #expect(dto.staleCount == 8)
        #expect(dto.consolidationsPerformed == 3)
        #expect(dto.lastDecayRunAt != nil)
    }

    @Test("Decode MemoryPromotionProposalDTO from fixture")
    func decodeMemoryPromotionProposal() throws {
        let data = try loadFixture("memory_promotion_proposal")
        let dto = try decoder.decode(MemoryPromotionProposalDTO.self, from: data)

        #expect(dto.memoryId == "mem-001")
        #expect(dto.targetPath == "MEMORY.md")
        #expect(dto.diff.contains("commit messages"))
        #expect(dto.approved == false)
        #expect(dto.promoted == false)
    }

    @Test("Decode MemoryHistoryDTO from fixture")
    func decodeMemoryHistory() throws {
        let data = try loadFixture("memory_history")
        let dto = try decoder.decode(MemoryHistoryDTO.self, from: data)

        #expect(dto.memoryId == "mem-001")
        #expect(dto.versionChain.count == 2)
        #expect(dto.versionChain[0].isLatest == true)
        #expect(dto.versionChain[1].isLatest == false)
        #expect(dto.evidenceLinks.count == 1)
        #expect(dto.operatorActions.count == 1)
        #expect(dto.operatorActions[0].actionKind == "pin")
    }

    // MARK: - Agent Profile DTOs

    @Test("Decode AgentProfileDTO from fixture")
    func decodeAgentProfile() throws {
        let data = try loadFixture("agent_profile")
        let dto = try decoder.decode(AgentProfileDTO.self, from: data)

        #expect(dto.id == "default")
        #expect(dto.name == "Default Agent")
        #expect(dto.mode == "interactive")
        #expect(dto.modelPolicy == "inherit")
        #expect(dto.allowedRuntimeTools.count == 2)
        #expect(dto.allowedCapabilityIds.contains("files"))
        #expect(dto.memoryScope == "workspace")
        #expect(dto.recallScope == "workspace")
        #expect(dto.filesystemPolicyClass == "workspace")
        #expect(dto.contextReleasePolicy == "summary_only")
        #expect(dto.updatedAt != nil)
    }

    // MARK: - Instruction Preview DTOs

    @Test("Decode InstructionPreviewDTO from fixture")
    func decodeInstructionPreview() throws {
        let data = try loadFixture("instruction_preview")
        let dto = try decoder.decode(InstructionPreviewDTO.self, from: data)

        #expect(dto.id == "bundle-abc123")
        #expect(dto.sources.count == 2)
        #expect(dto.sources[0].type == "pi_base")
        #expect(dto.sources[0].precedence == 1)
        #expect(dto.sources[1].type == "workspace")
        #expect(dto.sources[1].path == "WORKSPACE.md")
        #expect(dto.compiledText.contains("helpful assistant"))
        #expect(dto.bundleHash == "bundlehash-xyz")
        #expect(dto.warnings.isEmpty)
    }

    // MARK: - Telegram DTOs

    @Test("Decode TelegramDeliveryDTO from fixture")
    func decodeTelegramDelivery() throws {
        let data = try loadFixture("telegram_delivery")
        let dto = try decoder.decode(TelegramDeliveryDTO.self, from: data)

        #expect(dto.id == "tdel-001")
        #expect(dto.workspaceId == "default")
        #expect(dto.chatId == "123456789")
        #expect(dto.telegramMessageId == 42)
        #expect(dto.messageIngressId == "ming-001")
        #expect(dto.taskId == "task-abc")
        #expect(dto.runId == "run-ghi")
        #expect(dto.status == "uncertain")
        #expect(dto.sentAt == nil)
        #expect(dto.sentTelegramMessageId == nil)
    }

    @Test("Decode TelegramSendAttemptDTO from fixture")
    func decodeTelegramSendAttempt() throws {
        let data = try loadFixture("telegram_send_attempt")
        let dto = try decoder.decode(TelegramSendAttemptDTO.self, from: data)

        #expect(dto.id == "tsa-001")
        #expect(dto.deliveryId == "tdel-001")
        #expect(dto.attemptNumber == 1)
        #expect(dto.outcome == "ambiguous")
        #expect(dto.errorSummary == "Network timeout after 2000ms")
        #expect(dto.source == "relay")
        #expect(dto.sentTelegramMessageId == nil)
    }

    @Test("Decode TelegramResolutionDTO from fixture")
    func decodeTelegramResolution() throws {
        let data = try loadFixture("telegram_resolution")
        let dto = try decoder.decode(TelegramResolutionDTO.self, from: data)

        #expect(dto.id == "tres-001")
        #expect(dto.deliveryId == "tdel-001")
        #expect(dto.action == "confirm_sent")
        #expect(dto.operatorNote?.contains("Verified") == true)
        #expect(dto.sentTelegramMessageId == 43)
        #expect(dto.previousStatus == "uncertain")
        #expect(dto.newStatus == "sent")
    }

    @Test("Decode TelegramRelayCheckpointDTO from fixture")
    func decodeTelegramRelayCheckpoint() throws {
        let data = try loadFixture("telegram_relay_checkpoint")
        let dto = try decoder.decode(TelegramRelayCheckpointDTO.self, from: data)

        #expect(dto.relayKey == "telegram_long_poll")
        #expect(dto.workspaceId == "default")
        #expect(dto.lastAcknowledgedUpdateId == 98765432)
        #expect(dto.updatedAt.isEmpty == false)
    }

    // MARK: - Connection DTOs

    @Test("Decode ConnectionDTO from fixture with policy, health, sync")
    func decodeConnection() throws {
        let data = try loadFixture("connection")
        let dto = try decoder.decode(ConnectionDTO.self, from: data)

        #expect(dto.id == "conn-gh-001")
        #expect(dto.domain == "github")
        #expect(dto.providerKind == "oauth")
        #expect(dto.label == "GitHub (nationalbank)")
        #expect(dto.mode == "read_write")
        #expect(dto.enabled == true)
        #expect(dto.lastSyncAt != nil)
        #expect(dto.lastSyncStatus == "success")

        // Policy
        let policy = try #require(dto.policy)
        #expect(policy.status == "ready")
        #expect(policy.secretStatus == "configured")
        #expect(policy.mutatingRequiresApproval == true)

        // Health
        let health = try #require(dto.health)
        #expect(health.status == "healthy")
        #expect(health.authState == "configured")
        #expect(health.checkedAt != nil)
        #expect(health.lastError == nil)
        #expect(health.remediation == nil)

        // Sync
        let sync = try #require(dto.sync)
        #expect(sync.status == "success")
        #expect(sync.lagSummary == "0s")
        #expect(sync.lastSuccessAt != nil)
    }
}
