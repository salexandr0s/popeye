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

    @Test("Decode OAuthSessionDTO from fixture")
    func decodeOAuthSession() throws {
        let data = try loadFixture("oauth_session")
        let dto = try decoder.decode(OAuthSessionDTO.self, from: data)

        #expect(dto.id == "oauth-session-001")
        #expect(dto.providerKind == "github")
        #expect(dto.domain == "github")
        #expect(dto.status == "pending")
        #expect(dto.authorizationUrl.contains("github.com/login/oauth/authorize"))
        #expect(dto.connectionId == "conn-gh-001")
        #expect(dto.completedAt == nil)
    }

    @Test("Decode SecretRefDTO from fixture")
    func decodeSecretRef() throws {
        let data = try loadFixture("secret_ref")
        let dto = try decoder.decode(SecretRefDTO.self, from: data)

        #expect(dto.id == "secret-telegram-bot")
        #expect(dto.provider == "keychain")
        #expect(dto.key == "telegram-bot-token")
        #expect(dto.connectionId == nil)
        #expect(dto.description == "Telegram bot token")
    }

    @Test("Decode curated document DTOs from inline JSON")
    func decodeCuratedDocuments() throws {
        let summaryData = Data("""
        {
          "id": "workspace:default:instructions",
          "kind": "workspace_instructions",
          "workspace_id": "default",
          "project_id": null,
          "title": "Workspace Instructions",
          "subtitle": "Default workspace",
          "file_path": "/tmp/default/WORKSPACE.md",
          "writable": true,
          "critical": true,
          "exists": true,
          "updated_at": "2026-04-02T09:00:00Z"
        }
        """.utf8)
        let recordData = Data("""
        {
          "id": "workspace:default:instructions",
          "kind": "workspace_instructions",
          "workspace_id": "default",
          "project_id": null,
          "title": "Workspace Instructions",
          "subtitle": "Default workspace",
          "file_path": "/tmp/default/WORKSPACE.md",
          "writable": true,
          "critical": true,
          "exists": true,
          "updated_at": "2026-04-02T09:00:00Z",
          "markdown_text": "# Workspace\\n\\nHello.\\n",
          "revision_hash": "sha256:abc"
        }
        """.utf8)
        let proposalData = Data("""
        {
          "document_id": "workspace:default:instructions",
          "status": "ready",
          "normalized_markdown": "# Workspace\\n\\nUpdated.\\n",
          "diff_preview": "@@ -1 +1 @@",
          "base_revision_hash": "sha256:abc",
          "current_revision_hash": "sha256:abc",
          "requires_explicit_confirmation": true,
          "redaction_applied": false,
          "conflict_message": null
        }
        """.utf8)

        let summary = try decoder.decode(CuratedDocumentSummaryDTO.self, from: summaryData)
        let record = try decoder.decode(CuratedDocumentRecordDTO.self, from: recordData)
        let proposal = try decoder.decode(CuratedDocumentSaveProposalDTO.self, from: proposalData)

        #expect(summary.kind == "workspace_instructions")
        #expect(record.markdownText.contains("Hello"))
        #expect(record.revisionHash == "sha256:abc")
        #expect(proposal.requiresExplicitConfirmation == true)
        #expect(proposal.status == "ready")
    }

    @Test("Decode HomeSummaryDTO from inline JSON")
    func decodeHomeSummary() throws {
        let data = Data("""
        {
          "workspace_id": "default",
          "workspace_name": "Default workspace",
          "status": {
            "ok": true,
            "running_jobs": 1,
            "queued_jobs": 0,
            "open_interventions": 0,
            "active_leases": 1,
            "engine_kind": "fake",
            "scheduler_running": true,
            "started_at": "2026-04-02T08:00:00Z",
            "last_shutdown_at": null
          },
          "scheduler": {
            "running": true,
            "active_leases": 1,
            "active_runs": 1,
            "next_heartbeat_due_at": "2026-04-02T09:00:00Z"
          },
          "capabilities": {
            "engine_kind": "fake",
            "persistent_session_support": false,
            "resume_by_session_ref_support": false,
            "host_tool_mode": "none",
            "compaction_event_support": false,
            "cancellation_mode": "none",
            "accepted_request_metadata": [],
            "warnings": []
          },
          "setup": {
            "supported_provider_count": 4,
            "healthy_provider_count": 3,
            "attention_provider_count": 1,
            "telegram_status_label": "Token stored; apply pending",
            "telegram_effective_workspace_id": "default"
          },
          "automation_attention": [{
            "id": "task:heartbeat:default",
            "workspace_id": "default",
            "task_id": "task:heartbeat:default",
            "source": "heartbeat",
            "title": "Heartbeat automation",
            "task_status": "active",
            "job_id": null,
            "job_status": null,
            "status": "healthy",
            "enabled": true,
            "schedule_summary": "Every 15m",
            "interval_seconds": 900,
            "last_run_at": null,
            "last_success_at": null,
            "last_failure_at": null,
            "next_expected_at": "2026-04-02T09:00:00Z",
            "blocked_reason": null,
            "attention_reason": null,
            "open_intervention_count": 0,
            "pending_approval_count": 0,
            "controls": {
              "run_now": true,
              "pause": true,
              "resume": false,
              "enabled_edit": true,
              "cadence_edit": true
            }
          }],
          "automation_due_soon": [],
          "upcoming_events": [],
          "calendar_digest": null,
          "upcoming_todos": [],
          "todo_digest": null,
          "recent_memories": [],
          "control_changes": [],
          "pending_approval_count": 1
        }
        """.utf8)

        let dto = try decoder.decode(HomeSummaryDTO.self, from: data)

        #expect(dto.workspaceId == "default")
        #expect(dto.setup.telegramStatusLabel.contains("Token stored"))
        #expect(dto.automationAttention.count == 1)
        #expect(dto.pendingApprovalCount == 1)
    }

    @Test("Decode AutomationDetailDTO from fixture")
    func decodeAutomationDetail() throws {
        let data = try loadFixture("automation_detail")
        let dto = try decoder.decode(AutomationDetailDTO.self, from: data)

        #expect(dto.id == "task:heartbeat:default")
        #expect(dto.workspaceId == "default")
        #expect(dto.source == "heartbeat")
        #expect(dto.enabled == true)
        #expect(dto.controls.runNow == true)
        #expect(dto.controls.pause == true)
        #expect(dto.recentRuns.count == 1)
        #expect(dto.recentRuns[0].pendingApprovalCount == 1)
    }

    @Test("Decode Email account, thread, digest, and search fixtures")
    func decodeEmailDomainDTOs() throws {
        let accountData = try loadFixture("email_account")
        let threadData = try loadFixture("email_thread")
        let digestData = try loadFixture("email_digest")

        let account = try decoder.decode(EmailAccountDTO.self, from: accountData)
        let thread = try decoder.decode(EmailThreadDTO.self, from: threadData)
        let digest = try decoder.decode(EmailDigestDTO.self, from: digestData)
        let search = try decoder.decode(
            EmailSearchResponseDTO.self,
            from: Data(
                """
                {
                  "query": "launch",
                  "results": [
                    {
                      "threadId": "thread-1",
                      "subject": "Launch plan",
                      "snippet": "Draft the launch note and gather approvals.",
                      "from": "annie@example.com",
                      "lastMessageAt": "2026-04-09T09:00:00Z",
                      "score": 0.98
                    }
                  ]
                }
                """.utf8)
        )

        #expect(account.id == "email-acct-1")
        #expect(account.emailAddress == "operator@example.com")
        #expect(thread.id == "thread-1")
        #expect(thread.isUnread == true)
        #expect(thread.labelIds.contains("INBOX"))
        #expect(digest.accountId == "email-acct-1")
        #expect(digest.unreadCount == 12)
        #expect(search.query == "launch")
        #expect(search.results.first?.threadId == "thread-1")
        #expect(search.results.first?.from == "annie@example.com")
    }

    @Test("Decode Calendar account, event, and digest fixtures")
    func decodeCalendarDomainDTOs() throws {
        let accountData = try loadFixture("calendar_account")
        let eventData = try loadFixture("calendar_event")
        let digestData = try loadFixture("calendar_digest")

        let account = try decoder.decode(CalendarAccountDTO.self, from: accountData)
        let event = try decoder.decode(CalendarEventDTO.self, from: eventData)
        let digest = try decoder.decode(CalendarDigestDTO.self, from: digestData)

        #expect(account.id == "calendar-acct-1")
        #expect(account.calendarEmail == "operator@example.com")
        #expect(event.id == "event-1")
        #expect(event.isAllDay == false)
        #expect(event.attendees.count == 2)
        #expect(digest.accountId == "calendar-acct-1")
        #expect(digest.todayEventCount == 3)
    }

    @Test("Decode Todo account, project, item, and digest fixtures")
    func decodeTodoDomainDTOs() throws {
        let accountData = try loadFixture("todo_account")
        let projectData = try loadFixture("todo_project")
        let itemData = try loadFixture("todo_item")
        let digestData = try loadFixture("todo_digest")

        let account = try decoder.decode(TodoAccountDTO.self, from: accountData)
        let project = try decoder.decode(TodoProjectDTO.self, from: projectData)
        let item = try decoder.decode(TodoItemDTO.self, from: itemData)
        let digest = try decoder.decode(TodoDigestDTO.self, from: digestData)

        #expect(account.id == "todo-acct-1")
        #expect(account.providerKind == "todoist")
        #expect(project.id == "project-1")
        #expect(project.todoCount == 8)
        #expect(item.id == "todo-1")
        #expect(item.projectName == "Inbox")
        #expect(item.labels.contains("today"))
        #expect(digest.pendingCount == 14)
    }

    @Test("Decode Todo reconcile result DTO")
    func decodeTodoReconcileResultDTO() throws {
        let data = Data("""
        {
          "accountId": "todo-acct-1",
          "added": 3,
          "updated": 5,
          "removed": 1,
          "errors": []
        }
        """.utf8)

        let result = try decoder.decode(TodoReconcileResultDTO.self, from: data)

        #expect(result.accountId == "todo-acct-1")
        #expect(result.added == 3)
        #expect(result.updated == 5)
        #expect(result.removed == 1)
        #expect(result.errors.isEmpty)
    }

    @Test("Decode people fixtures")
    func decodePeopleDTOs() throws {
        let personData = try loadFixture("person")
        let searchData = try loadFixture("person_search")
        let mergeEventData = try loadFixture("person_merge_event")
        let mergeSuggestionData = try loadFixture("person_merge_suggestion")
        let activityData = try loadFixture("person_activity")

        let person = try decoder.decode(PersonDTO.self, from: personData)
        let search = try decoder.decode(PersonSearchResponseDTO.self, from: searchData)
        let mergeEvent = try decoder.decode(PersonMergeEventDTO.self, from: mergeEventData)
        let mergeSuggestion = try decoder.decode(PersonMergeSuggestionDTO.self, from: mergeSuggestionData)
        let activity = try decoder.decode(PersonActivityRollupDTO.self, from: activityData)

        #expect(person.id == "person-1")
        #expect(person.displayName == "Annie Case")
        #expect(person.identities.count == 1)
        #expect(search.results.first?.personId == "person-1")
        #expect(mergeEvent.eventType == "merge")
        #expect(mergeSuggestion.confidence == 0.91)
        #expect(activity.domain == "email")
    }

    @Test("Decode files fixtures")
    func decodeFilesDTOs() throws {
        let rootData = try loadFixture("file_root")
        let documentData = try loadFixture("file_document")
        let searchData = try loadFixture("file_search")
        let writeIntentData = try loadFixture("file_write_intent")

        let root = try decoder.decode(FileRootDTO.self, from: rootData)
        let document = try decoder.decode(FileDocumentDTO.self, from: documentData)
        let search = try decoder.decode(FileSearchResponseDTO.self, from: searchData)
        let writeIntent = try decoder.decode(FileWriteIntentDTO.self, from: writeIntentData)

        #expect(root.id == "root-1")
        #expect(root.workspaceId == "default")
        #expect(document.id == "doc-1")
        #expect(document.relativePath == "notes/design.md")
        #expect(search.results.first?.documentId == "doc-1")
        #expect(writeIntent.status == "pending")
    }

    @Test("Decode finance and vault fixtures")
    func decodeFinanceDTOs() throws {
        let vaultData = try loadFixture("vault_record")
        let importData = try loadFixture("finance_import")
        let transactionData = try loadFixture("finance_transaction")
        let documentData = try loadFixture("finance_document")
        let digestData = try loadFixture("finance_digest")
        let searchData = try loadFixture("finance_search")

        let vault = try decoder.decode(VaultRecordDTO.self, from: vaultData)
        let entry = try decoder.decode(FinanceImportDTO.self, from: importData)
        let transaction = try decoder.decode(FinanceTransactionDTO.self, from: transactionData)
        let document = try decoder.decode(FinanceDocumentDTO.self, from: documentData)
        let digest = try decoder.decode(FinanceDigestDTO.self, from: digestData)
        let search = try decoder.decode(FinanceSearchResponseDTO.self, from: searchData)

        #expect(vault.domain == "finance")
        #expect(vault.encrypted == true)
        #expect(entry.id == "finance-import-1")
        #expect(transaction.amount == -84.25)
        #expect(document.fileName == "statement.pdf")
        #expect(digest.anomalyFlags.count == 1)
        #expect(search.results.first?.transactionId == "txn-1")
    }

    @Test("Decode medical fixtures")
    func decodeMedicalDTOs() throws {
        let importData = try loadFixture("medical_import")
        let appointmentData = try loadFixture("medical_appointment")
        let medicationData = try loadFixture("medical_medication")
        let documentData = try loadFixture("medical_document")
        let digestData = try loadFixture("medical_digest")
        let searchData = try loadFixture("medical_search")

        let entry = try decoder.decode(MedicalImportDTO.self, from: importData)
        let appointment = try decoder.decode(MedicalAppointmentDTO.self, from: appointmentData)
        let medication = try decoder.decode(MedicalMedicationDTO.self, from: medicationData)
        let document = try decoder.decode(MedicalDocumentDTO.self, from: documentData)
        let digest = try decoder.decode(MedicalDigestDTO.self, from: digestData)
        let search = try decoder.decode(MedicalSearchResponseDTO.self, from: searchData)

        #expect(entry.id == "medical-import-1")
        #expect(appointment.provider == "Dr. Rivera")
        #expect(medication.name == "Amoxicillin")
        #expect(document.fileName == "visit-summary.pdf")
        #expect(digest.activeMedications == 2)
        #expect(search.results.first?.recordId == "medication-1")
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
        #expect(dto.playbooks.count == 1)
        #expect(dto.playbooks[0].id == "triage")
        #expect(dto.playbooks[0].scope == "workspace")
        #expect(dto.sources[0].type == "pi_base")
        #expect(dto.sources[0].precedence == 1)
        #expect(dto.sources[1].type == "workspace")
        #expect(dto.sources[1].path == "WORKSPACE.md")
        #expect(dto.compiledText.contains("helpful assistant"))
        #expect(dto.bundleHash == "bundlehash-xyz")
        #expect(dto.warnings.isEmpty)
    }

    @Test("Decode IdentityRecordDTO list from fixture")
    func decodeIdentityList() throws {
        let data = try loadFixture("identity_list")
        let dto = try decoder.decode([IdentityRecordDTO].self, from: data)

        #expect(dto.count == 2)
        #expect(dto[0].id == "default")
        #expect(dto[0].workspaceId == "default")
        #expect(dto[0].exists == true)
        #expect(dto[0].selected == true)
        #expect(dto[1].path == "identities/reviewer.md")
    }

    @Test("Decode WorkspaceIdentityDefaultDTO from fixture")
    func decodeDefaultIdentity() throws {
        let data = try loadFixture("identity_default")
        let dto = try decoder.decode(WorkspaceIdentityDefaultDTO.self, from: data)

        #expect(dto.workspaceId == "default")
        #expect(dto.identityId == "default")
        #expect(dto.updatedAt == "2026-03-24T08:15:00Z")
    }

    @Test("Decode WorkspaceRecordDTO list from inline JSON")
    func decodeWorkspaceList() throws {
        let data = Data("""
        [
          {
            "id": "default",
            "name": "Default workspace",
            "rootPath": "/Users/example/Assistant",
            "createdAt": "2026-03-31T09:00:00Z"
          },
          {
            "id": "projects",
            "name": "Projects",
            "rootPath": "/Users/example/Projects",
            "createdAt": "2026-03-31T09:05:00Z"
          }
        ]
        """.utf8)

        let dto = try decoder.decode([WorkspaceRecordDTO].self, from: data)

        #expect(dto.count == 2)
        #expect(dto[0].id == "default")
        #expect(dto[0].createdAt == "2026-03-31T09:00:00Z")
        #expect(dto[1].rootPath == "/Users/example/Projects")
    }

    @Test("Decode TelegramConfigSnapshotDTO from inline JSON")
    func decodeTelegramConfigSnapshot() throws {
        let data = Data("""
        {
          "persisted": {
            "enabled": true,
            "allowedUserId": "5315323298",
            "secretRefId": "secret-telegram-bot"
          },
          "applied": {
            "enabled": false,
            "allowedUserId": null,
            "secretRefId": null
          },
          "effectiveWorkspaceId": "default",
          "secretAvailability": "available",
          "staleComparedToApplied": true,
          "warnings": [
            "Saved Telegram settings differ from the daemon-applied settings."
          ],
          "managementMode": "launchd",
          "restartSupported": true
        }
        """.utf8)

        let dto = try decoder.decode(TelegramConfigSnapshotDTO.self, from: data)

        #expect(dto.persisted.enabled == true)
        #expect(dto.persisted.allowedUserId == "5315323298")
        #expect(dto.applied.enabled == false)
        #expect(dto.secretAvailability == "available")
        #expect(dto.staleComparedToApplied == true)
        #expect(dto.managementMode == "launchd")
        #expect(dto.restartSupported == true)
    }

    @Test("Decode MutationReceiptDTO from inline JSON")
    func decodeMutationReceipt() throws {
        let data = Data("""
        {
          "id": "mut-telegram-001",
          "kind": "telegram_config_update",
          "component": "telegram",
          "status": "succeeded",
          "summary": "Saved Telegram config: enabled, allowedUserId, secretRefId",
          "details": "enabled false → true; secretRefId absent → present",
          "actorRole": "operator",
          "workspaceId": null,
          "usage": {
            "provider": "control-plane",
            "model": "mutation",
            "tokensIn": 0,
            "tokensOut": 0,
            "estimatedCostUsd": 0
          },
          "metadata": {
            "effectiveWorkspaceId": "default"
          },
          "createdAt": "2026-03-31T09:05:00Z"
        }
        """.utf8)

        let dto = try decoder.decode(MutationReceiptDTO.self, from: data)

        #expect(dto.kind == "telegram_config_update")
        #expect(dto.component == "telegram")
        #expect(dto.status == "succeeded")
        #expect(dto.usage.provider == "control-plane")
        #expect(dto.metadata["effectiveWorkspaceId"] == "default")
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

    @Test("Decode ConnectionDiagnosticsDTO from inline JSON")
    func decodeConnectionDiagnostics() throws {
        let data = Data("""
        {
          "connection_id": "conn-gh-001",
          "label": "GitHub",
          "provider_kind": "github",
          "domain": "github",
          "enabled": true,
          "health": {
            "status": "degraded",
            "auth_state": "invalid_scopes",
            "checked_at": "2026-04-08T10:00:00Z",
            "last_error": "Missing repo scope",
            "diagnostics": [
              { "code": "missing_scope", "severity": "warn", "message": "Repository write scope is missing." }
            ],
            "remediation": {
              "action": "scope_fix",
              "message": "Reconnect GitHub to repair scopes.",
              "updated_at": "2026-04-08T10:01:00Z"
            }
          },
          "sync": {
            "last_attempt_at": "2026-04-08T09:55:00Z",
            "last_success_at": "2026-04-08T09:50:00Z",
            "status": "partial",
            "cursor_kind": "since",
            "cursor_present": true,
            "lag_summary": "5m behind"
          },
          "policy": {
            "status": "ready",
            "secret_status": "configured",
            "mutating_requires_approval": true,
            "diagnostics": [
              { "code": "approval_gate", "severity": "info", "message": "Mutations require approval." }
            ]
          },
          "remediation": {
            "action": "scope_fix",
            "message": "Reconnect GitHub to repair scopes.",
            "updated_at": "2026-04-08T10:01:00Z"
          },
          "human_summary": "GitHub connection is readable but missing write scopes."
        }
        """.utf8)

        let dto = try decoder.decode(ConnectionDiagnosticsDTO.self, from: data)

        #expect(dto.connectionId == "conn-gh-001")
        #expect(dto.health.status == "degraded")
        #expect(dto.health.diagnostics?.first?.code == "missing_scope")
        #expect(dto.sync.cursorKind == "since")
        #expect(dto.policy.diagnostics?.first?.severity == "info")
        #expect(dto.humanSummary.contains("missing write scopes"))
    }

    @Test("Decode ConnectionResourceRuleDTO list from inline JSON")
    func decodeConnectionResourceRules() throws {
        let data = Data("""
        [
          {
            "resource_type": "repo",
            "resource_id": "nationalbank/popeye",
            "display_name": "popeye",
            "write_allowed": true,
            "created_at": "2026-04-08T09:00:00Z",
            "updated_at": "2026-04-08T09:00:00Z"
          }
        ]
        """.utf8)

        let dto = try decoder.decode([ConnectionResourceRuleDTO].self, from: data)
        #expect(dto.count == 1)
        #expect(dto.first?.resourceType == "repo")
        #expect(dto.first?.writeAllowed == true)
    }

    @Test("Decode EmailDraftDTO and EmailDraftDetailDTO from inline JSON")
    func decodeEmailDraft() throws {
        let dto = try decoder.decode(
            EmailDraftDTO.self,
            from: Data(
                """
                {
                  "id": "email-draft-1",
                  "accountId": "email-acct-1",
                  "connectionId": "conn-email-1",
                  "providerDraftId": "draft-1",
                  "providerMessageId": null,
                  "to": ["annie@example.com"],
                  "cc": ["ben@example.com"],
                  "subject": "Launch plan",
                  "bodyPreview": "Draft the launch note.",
                  "updatedAt": "2026-04-09T09:00:00Z"
                }
                """.utf8)
        )

        #expect(dto.providerDraftId == "draft-1")
        #expect(dto.to == ["annie@example.com"])
        #expect(dto.cc == ["ben@example.com"])
        #expect(dto.bodyPreview == "Draft the launch note.")

        let detail = try decoder.decode(
            EmailDraftDetailDTO.self,
            from: Data(
                """
                {
                  "id": "email-draft-1",
                  "accountId": "email-acct-1",
                  "connectionId": "conn-email-1",
                  "providerDraftId": "draft-1",
                  "providerMessageId": null,
                  "to": ["annie@example.com"],
                  "cc": ["ben@example.com"],
                  "subject": "Launch plan",
                  "bodyPreview": "Draft the launch note.",
                  "updatedAt": "2026-04-09T09:00:00Z",
                  "body": "Hello Annie,\\n\\nDraft the launch note."
                }
                """.utf8)
        )

        #expect(detail.providerDraftId == "draft-1")
        #expect(detail.body == "Hello Annie,\n\nDraft the launch note.")
    }
}
