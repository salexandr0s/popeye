import Foundation
import PopeyeAPI

enum FeaturePreviewFixtures {
    private static let decoder = ResponseDecoder.makeDecoder()

    static func suspended<T>() async throws -> T {
        try await Task.sleep(for: .seconds(60))
        throw APIError.transportUnavailable
    }

    @MainActor
    static func previewAppModel() -> AppModel {
        let appModel = AppModel()
        appModel.workspace.replaceWorkspaces([workspace])
        appModel.selectedWorkspaceID = workspace.id
        return appModel
    }

    static let workspace: WorkspaceRecordDTO = decode(
        """
        {
          "id": "preview-workspace",
          "name": "Preview Workspace",
          "root_path": "/tmp/preview-workspace",
          "created_at": "2026-04-03T10:00:00Z"
        }
        """,
        as: WorkspaceRecordDTO.self
    )

    static let fileRoot: FileRootDTO = decode(
        """
        {
          "id": "root-001",
          "workspace_id": "preview-workspace",
          "label": "Workspace Notes",
          "root_path": "/tmp/preview-workspace/docs",
          "permission": "index",
          "file_patterns": ["**/*.md"],
          "exclude_patterns": [".git/**"],
          "max_file_size_bytes": 1048576,
          "enabled": true,
          "last_indexed_at": "2026-04-03T09:30:00Z",
          "last_indexed_count": 18,
          "created_at": "2026-04-01T08:00:00Z",
          "updated_at": "2026-04-03T09:30:00Z"
        }
        """,
        as: FileRootDTO.self
    )

    static let fileDocument: FileDocumentDTO = decode(
        """
        {
          "id": "doc-001",
          "file_root_id": "root-001",
          "relative_path": "memory/MEMORY.md",
          "content_hash": "abc123def456",
          "size_bytes": 4096,
          "memory_id": "mem-001",
          "created_at": "2026-04-02T11:00:00Z",
          "updated_at": "2026-04-03T08:45:00Z"
        }
        """,
        as: FileDocumentDTO.self
    )

    static let fileSearchResults: [FileSearchResultDTO] = decode(
        """
        [
          {
            "document_id": "doc-001",
            "file_root_id": "root-001",
            "relative_path": "memory/MEMORY.md",
            "memory_id": "mem-001",
            "score": 0.96,
            "snippet": "Recent memory promotions and operator notes."
          },
          {
            "document_id": "doc-002",
            "file_root_id": "root-001",
            "relative_path": "runbooks/incident.md",
            "memory_id": null,
            "score": 0.74,
            "snippet": "Incident response checklist for daemon restarts."
          }
        ]
        """,
        as: [FileSearchResultDTO].self
    )

    static let fileWriteIntents: [FileWriteIntentDTO] = decode(
        """
        [
          {
            "id": "intent-001",
            "file_root_id": "root-001",
            "file_path": "memory/MEMORY.md",
            "intent_type": "append",
            "diff_preview": "+ Added refreshed memory summary",
            "status": "pending",
            "run_id": "run-001",
            "approval_id": null,
            "receipt_id": null,
            "created_at": "2026-04-03T09:35:00Z",
            "reviewed_at": null
          }
        ]
        """,
        as: [FileWriteIntentDTO].self
    )

    static let fileIndexResult: FileIndexResultDTO = decode(
        """
        {
          "root_id": "root-001",
          "indexed": 18,
          "updated": 2,
          "skipped": 1,
          "stale": 0,
          "errors": []
        }
        """,
        as: FileIndexResultDTO.self
    )

    static let financeVault: VaultRecordDTO = decode(
        """
        {
          "id": "vault-finance-001",
          "domain": "finance",
          "kind": "sqlite",
          "db_path": "/tmp/preview-workspace/finance.db",
          "encrypted": true,
          "encryption_key_ref": "keychain:finance",
          "status": "closed",
          "created_at": "2026-03-01T09:00:00Z",
          "last_accessed_at": "2026-04-02T12:00:00Z"
        }
        """,
        as: VaultRecordDTO.self
    )

    static let financeImports: [FinanceImportDTO] = decode(
        """
        [
          {
            "id": "fin-import-001",
            "vault_id": "vault-finance-001",
            "import_type": "csv",
            "file_name": "march-transactions.csv",
            "status": "reviewed",
            "record_count": 42,
            "imported_at": "2026-04-01T09:00:00Z"
          }
        ]
        """,
        as: [FinanceImportDTO].self
    )

    static let financeTransactions: [FinanceTransactionDTO] = decode(
        """
        [
          {
            "id": "txn-001",
            "import_id": "fin-import-001",
            "date": "2026-03-28T00:00:00Z",
            "description": "Groceries",
            "amount": -84.12,
            "currency": "USD",
            "category": "groceries",
            "merchant_name": "Corner Market",
            "account_label": "Checking",
            "redacted_summary": "Weekly grocery spend"
          }
        ]
        """,
        as: [FinanceTransactionDTO].self
    )

    static let financeDocuments: [FinanceDocumentDTO] = decode(
        """
        [
          {
            "id": "fin-doc-001",
            "import_id": "fin-import-001",
            "file_name": "march-statement.pdf",
            "mime_type": "application/pdf",
            "size_bytes": 8192,
            "redacted_summary": "Monthly statement"
          }
        ]
        """,
        as: [FinanceDocumentDTO].self
    )

    static let financeDigest: FinanceDigestDTO = decode(
        """
        {
          "id": "fin-digest-001",
          "period": "month",
          "total_income": 4200,
          "total_expenses": 84.12,
          "category_breakdown": { "groceries": -84.12 },
          "anomaly_flags": [
            {
              "description": "Unexpected large grocery spend",
              "severity": "info",
              "transaction_id": "txn-001"
            }
          ],
          "generated_at": "2026-04-03T09:40:00Z"
        }
        """,
        as: FinanceDigestDTO.self
    )

    static let financeSearchResults: [FinanceSearchResultDTO] = decode(
        """
        [
          {
            "transaction_id": "txn-001",
            "date": "2026-03-28T00:00:00Z",
            "description": "Groceries",
            "amount": -84.12,
            "redacted_summary": "Weekly grocery spend",
            "score": 0.91
          }
        ]
        """,
        as: [FinanceSearchResultDTO].self
    )

    static let medicalVault: VaultRecordDTO = decode(
        """
        {
          "id": "vault-medical-001",
          "domain": "medical",
          "kind": "sqlite",
          "db_path": "/tmp/preview-workspace/medical.db",
          "encrypted": true,
          "encryption_key_ref": "keychain:medical",
          "status": "open",
          "created_at": "2026-03-01T09:00:00Z",
          "last_accessed_at": "2026-04-02T12:00:00Z"
        }
        """,
        as: VaultRecordDTO.self
    )

    static let medicalImports: [MedicalImportDTO] = decode(
        """
        [
          {
            "id": "med-import-001",
            "vault_id": "vault-medical-001",
            "import_type": "pdf",
            "file_name": "quarterly-summary.pdf",
            "status": "reviewed",
            "imported_at": "2026-04-01T09:00:00Z"
          }
        ]
        """,
        as: [MedicalImportDTO].self
    )

    static let medicalAppointments: [MedicalAppointmentDTO] = decode(
        """
        [
          {
            "id": "appt-001",
            "import_id": "med-import-001",
            "date": "2026-04-11T14:00:00Z",
            "provider": "Dr. Smith",
            "specialty": "Primary Care",
            "location": "Clinic A",
            "redacted_summary": "Routine follow-up appointment"
          }
        ]
        """,
        as: [MedicalAppointmentDTO].self
    )

    static let medicalMedications: [MedicalMedicationDTO] = decode(
        """
        [
          {
            "id": "med-001",
            "import_id": "med-import-001",
            "name": "Metformin",
            "dosage": "500mg",
            "frequency": "Twice daily",
            "prescriber": "Dr. Smith",
            "start_date": "2026-01-12T00:00:00Z",
            "end_date": null,
            "redacted_summary": "Active medication"
          }
        ]
        """,
        as: [MedicalMedicationDTO].self
    )

    static let medicalDocuments: [MedicalDocumentDTO] = decode(
        """
        [
          {
            "id": "med-doc-001",
            "import_id": "med-import-001",
            "file_name": "lab-results.pdf",
            "mime_type": "application/pdf",
            "size_bytes": 12288,
            "redacted_summary": "Recent lab report"
          }
        ]
        """,
        as: [MedicalDocumentDTO].self
    )

    static let medicalDigest: MedicalDigestDTO = decode(
        """
        {
          "id": "med-digest-001",
          "period": "quarter",
          "appointment_count": 1,
          "active_medications": 1,
          "summary": "One upcoming appointment and one active medication.",
          "generated_at": "2026-04-03T09:40:00Z"
        }
        """,
        as: MedicalDigestDTO.self
    )

    static let medicalSearchResults: [MedicalSearchResultDTO] = decode(
        """
        [
          {
            "record_id": "appt-001",
            "record_type": "appointment",
            "date": "2026-04-11T14:00:00Z",
            "redacted_summary": "Routine follow-up appointment",
            "score": 0.88
          }
        ]
        """,
        as: [MedicalSearchResultDTO].self
    )

    static let daemonStatus: DaemonStatusDTO = decode(
        """
        {
          "ok": true,
          "running_jobs": 1,
          "queued_jobs": 2,
          "open_interventions": 1,
          "active_leases": 1,
          "engine_kind": "pi",
          "scheduler_running": true,
          "started_at": "2026-04-03T07:00:00Z",
          "last_shutdown_at": null
        }
        """,
        as: DaemonStatusDTO.self
    )

    static let schedulerStatus: SchedulerStatusDTO = decode(
        """
        {
          "running": true,
          "active_leases": 1,
          "active_runs": 1,
          "next_heartbeat_due_at": "2026-04-03T10:00:00Z"
        }
        """,
        as: SchedulerStatusDTO.self
    )

    static let engineCapabilities: EngineCapabilitiesDTO = decode(
        """
        {
          "engine_kind": "pi",
          "persistent_session_support": true,
          "resume_by_session_ref_support": true,
          "host_tool_mode": "bridge",
          "compaction_event_support": true,
          "cancellation_mode": "signal",
          "accepted_request_metadata": ["workspaceId"],
          "warnings": []
        }
        """,
        as: EngineCapabilitiesDTO.self
    )

    static let usageSummary: UsageSummaryDTO = decode(
        """
        {
          "runs": 24,
          "tokens_in": 42000,
          "tokens_out": 18500,
          "estimated_cost_usd": 12.34
        }
        """,
        as: UsageSummaryDTO.self
    )

    static let memoryRecord: MemoryRecordDTO = decode(
        """
        {
          "id": "mem-001",
          "description": "Operator preference for daily memory reviews",
          "classification": "fact",
          "source_type": "receipt",
          "content": "Run a daily review of promoted memories before closing the day.",
          "confidence": 0.92,
          "scope": "workspace",
          "workspace_id": "preview-workspace",
          "project_id": null,
          "source_run_id": "run-001",
          "source_timestamp": "2026-04-03T08:30:00Z",
          "memory_type": "procedural",
          "dedup_key": "daily-review",
          "last_reinforced_at": "2026-04-03T09:10:00Z",
          "archived_at": null,
          "created_at": "2026-04-03T08:30:00Z",
          "durable": true,
          "domain": "operations",
          "context_release_policy": "summary_only"
        }
        """,
        as: MemoryRecordDTO.self
    )

    static let memoryRecords: [MemoryRecordDTO] = decode(
        """
        [
          {
            "id": "mem-001",
            "description": "Operator preference for daily memory reviews",
            "classification": "fact",
            "source_type": "receipt",
            "content": "Run a daily review of promoted memories before closing the day.",
            "confidence": 0.92,
            "scope": "workspace",
            "workspace_id": "preview-workspace",
            "project_id": null,
            "source_run_id": "run-001",
            "source_timestamp": "2026-04-03T08:30:00Z",
            "memory_type": "procedural",
            "dedup_key": "daily-review",
            "last_reinforced_at": "2026-04-03T09:10:00Z",
            "archived_at": null,
            "created_at": "2026-04-03T08:30:00Z",
            "durable": true,
            "domain": "operations",
            "context_release_policy": "summary_only"
          },
          {
            "id": "mem-002",
            "description": "Recent promotion proposal",
            "classification": "event",
            "source_type": "conversation",
            "content": "Promote the latest operator checklist into MEMORY.md after validation.",
            "confidence": 0.78,
            "scope": "workspace",
            "workspace_id": "preview-workspace",
            "project_id": null,
            "source_run_id": "run-002",
            "source_timestamp": "2026-04-03T09:00:00Z",
            "memory_type": "episodic",
            "dedup_key": null,
            "last_reinforced_at": null,
            "archived_at": null,
            "created_at": "2026-04-03T09:00:00Z",
            "durable": false,
            "domain": "memory",
            "context_release_policy": "summary_only"
          }
        ]
        """,
        as: [MemoryRecordDTO].self
    )

    static let memoryHistory: MemoryHistoryDTO = decode(
        """
        {
          "memory_id": "mem-001",
          "version_chain": [
            {
              "fact_id": "fact-001",
              "text": "Run a daily review of promoted memories before closing the day.",
              "created_at": "2026-04-03T08:30:00Z",
              "is_latest": true,
              "relation": null
            }
          ],
          "evidence_links": [
            {
              "artifact_id": "receipt-001",
              "excerpt": "Daily review completed and promoted.",
              "created_at": "2026-04-03T08:31:00Z"
            }
          ],
          "operator_actions": [
            {
              "action_kind": "pin",
              "reason": "Operationally important guidance.",
              "created_at": "2026-04-03T08:32:00Z"
            }
          ]
        }
        """,
        as: MemoryHistoryDTO.self
    )

    static let memorySearchHits: [MemorySearchHitDTO] = decode(
        """
        [
          {
            "id": "mem-001",
            "description": "Operator preference for daily memory reviews",
            "content": "Run a daily review of promoted memories before closing the day.",
            "type": "procedural",
            "confidence": 0.92,
            "effective_confidence": 0.94,
            "scope": "workspace",
            "workspace_id": "preview-workspace",
            "project_id": null,
            "source_type": "receipt",
            "created_at": "2026-04-03T08:30:00Z",
            "last_reinforced_at": "2026-04-03T09:10:00Z",
            "score": 0.96,
            "layer": "semantic",
            "domain": "operations",
            "score_breakdown": {
              "relevance": 0.98,
              "recency": 0.82,
              "confidence": 0.92,
              "scope_match": 1.0,
              "temporal_fit": null,
              "source_trust": null,
              "salience": null,
              "latestness": null,
              "evidence_density": null,
              "operator_bonus": null,
              "layer_prior": null
            }
          }
        ]
        """,
        as: [MemorySearchHitDTO].self
    )

    static let memoryPromotionProposal: MemoryPromotionProposalDTO = decode(
        """
        {
          "memory_id": "mem-001",
          "target_path": "MEMORY.md",
          "diff": "+ - Daily review promoted into curated memory\n",
          "approved": true,
          "promoted": false
        }
        """,
        as: MemoryPromotionProposalDTO.self
    )

    static let automationControls = AutomationControlAvailabilityDTO(
        runNow: true,
        pause: true,
        resume: true,
        enabledEdit: true,
        cadenceEdit: true
    )

    static let automationRecord = AutomationRecordDTO(
        id: "auto-001",
        workspaceId: workspace.id,
        taskId: "automation_task_001",
        source: "schedule",
        title: "Daily Memory Review",
        taskStatus: "active",
        jobId: "job-automation-001",
        jobStatus: "running",
        status: "attention",
        enabled: true,
        scheduleSummary: "Every day at 9:00 AM",
        intervalSeconds: 86_400,
        lastRunAt: "2026-04-03T08:55:00Z",
        lastSuccessAt: "2026-04-02T09:00:00Z",
        lastFailureAt: nil,
        nextExpectedAt: "2026-04-04T09:00:00Z",
        blockedReason: nil,
        attentionReason: "Review overdue",
        openInterventionCount: 1,
        pendingApprovalCount: 0,
        controls: automationControls
    )

    static let automationDetail = AutomationDetailDTO(
        id: automationRecord.id,
        workspaceId: automationRecord.workspaceId,
        taskId: automationRecord.taskId,
        source: automationRecord.source,
        title: automationRecord.title,
        taskStatus: automationRecord.taskStatus,
        jobId: automationRecord.jobId,
        jobStatus: automationRecord.jobStatus,
        status: automationRecord.status,
        enabled: automationRecord.enabled,
        scheduleSummary: automationRecord.scheduleSummary,
        intervalSeconds: automationRecord.intervalSeconds,
        lastRunAt: automationRecord.lastRunAt,
        lastSuccessAt: automationRecord.lastSuccessAt,
        lastFailureAt: automationRecord.lastFailureAt,
        nextExpectedAt: automationRecord.nextExpectedAt,
        blockedReason: automationRecord.blockedReason,
        attentionReason: automationRecord.attentionReason,
        openInterventionCount: automationRecord.openInterventionCount,
        pendingApprovalCount: automationRecord.pendingApprovalCount,
        controls: automationControls,
        recentRuns: [
            AutomationRecentRunDTO(
                id: "run-automation-001",
                jobId: "job-automation-001",
                state: "running",
                startedAt: "2026-04-03T08:55:00Z",
                finishedAt: nil,
                error: nil,
                receiptId: nil,
                pendingApprovalCount: 0,
                openInterventionCount: 1
            )
        ]
    )

    static let automationMutationReceipt: MutationReceiptDTO = decode(
        """
        {
          "id": "mutation-automation-001",
          "kind": "automation_update",
          "component": "automation",
          "status": "succeeded",
          "summary": "Updated Daily Memory Review",
          "details": "Cadence changed to every day at 9:00 AM.",
          "actor_role": "operator",
          "workspace_id": "preview-workspace",
          "usage": {
            "provider": "openai",
            "model": "gpt-5.4",
            "tokens_in": 128,
            "tokens_out": 256,
            "estimated_cost_usd": 0.012
          },
          "metadata": {
            "automationId": "auto-001"
          },
          "created_at": "2026-04-03T09:15:00Z"
        }
        """,
        as: MutationReceiptDTO.self
    )

    static let homeSummary: HomeSummaryDTO = decode(
        """
        {
          "workspace_id": "preview-workspace",
          "workspace_name": "Preview Workspace",
          "status": {
            "ok": true,
            "running_jobs": 1,
            "queued_jobs": 2,
            "open_interventions": 1,
            "active_leases": 1,
            "engine_kind": "pi",
            "scheduler_running": true,
            "started_at": "2026-04-03T07:00:00Z",
            "last_shutdown_at": null
          },
          "scheduler": {
            "running": true,
            "active_leases": 1,
            "active_runs": 1,
            "next_heartbeat_due_at": "2026-04-03T10:00:00Z"
          },
          "capabilities": {
            "engine_kind": "pi",
            "persistent_session_support": true,
            "resume_by_session_ref_support": true,
            "host_tool_mode": "bridge",
            "compaction_event_support": true,
            "cancellation_mode": "signal",
            "accepted_request_metadata": ["workspaceId"],
            "warnings": []
          },
          "setup": {
            "supported_provider_count": 4,
            "healthy_provider_count": 3,
            "attention_provider_count": 1,
            "telegram_status_label": "Configured",
            "telegram_effective_workspace_id": "preview-workspace"
          },
          "automation_attention": [
            {
              "id": "auto-001",
              "workspace_id": "preview-workspace",
              "task_id": "automation_task_001",
              "source": "schedule",
              "title": "Daily Memory Review",
              "task_status": "active",
              "job_id": "job-automation-001",
              "job_status": "running",
              "status": "attention",
              "enabled": true,
              "schedule_summary": "Every day at 9:00 AM",
              "interval_seconds": 86400,
              "last_run_at": "2026-04-03T08:55:00Z",
              "last_success_at": "2026-04-02T09:00:00Z",
              "last_failure_at": null,
              "next_expected_at": "2026-04-04T09:00:00Z",
              "blocked_reason": null,
              "attention_reason": "Review overdue",
              "open_intervention_count": 1,
              "pending_approval_count": 0,
              "controls": {
                "run_now": true,
                "pause": true,
                "resume": true,
                "enabled_edit": true,
                "cadence_edit": true
              }
            }
          ],
          "automation_due_soon": [
            {
              "id": "auto-001",
              "workspace_id": "preview-workspace",
              "task_id": "automation_task_001",
              "source": "schedule",
              "title": "Daily Memory Review",
              "task_status": "active",
              "job_id": "job-automation-001",
              "job_status": "running",
              "status": "attention",
              "enabled": true,
              "schedule_summary": "Every day at 9:00 AM",
              "interval_seconds": 86400,
              "last_run_at": "2026-04-03T08:55:00Z",
              "last_success_at": "2026-04-02T09:00:00Z",
              "last_failure_at": null,
              "next_expected_at": "2026-04-04T09:00:00Z",
              "blocked_reason": null,
              "attention_reason": "Review overdue",
              "open_intervention_count": 1,
              "pending_approval_count": 0,
              "controls": {
                "run_now": true,
                "pause": true,
                "resume": true,
                "enabled_edit": true,
                "cadence_edit": true
              }
            }
          ],
          "upcoming_events": [],
          "calendar_digest": null,
          "upcoming_todos": [],
          "todo_digest": null,
          "recent_memories": [
            {
              "id": "mem-001",
              "description": "Operator preference for daily memory reviews",
              "classification": "fact",
              "source_type": "receipt",
              "content": "Run a daily review of promoted memories before closing the day.",
              "confidence": 0.92,
              "scope": "workspace",
              "workspace_id": "preview-workspace",
              "project_id": null,
              "source_run_id": "run-001",
              "source_timestamp": "2026-04-03T08:30:00Z",
              "memory_type": "procedural",
              "dedup_key": "daily-review",
              "last_reinforced_at": "2026-04-03T09:10:00Z",
              "archived_at": null,
              "created_at": "2026-04-03T08:30:00Z",
              "durable": true,
              "domain": "operations",
              "context_release_policy": "summary_only"
            },
            {
              "id": "mem-002",
              "description": "Recent promotion proposal",
              "classification": "event",
              "source_type": "conversation",
              "content": "Promote the latest operator checklist into MEMORY.md after validation.",
              "confidence": 0.78,
              "scope": "workspace",
              "workspace_id": "preview-workspace",
              "project_id": null,
              "source_run_id": "run-002",
              "source_timestamp": "2026-04-03T09:00:00Z",
              "memory_type": "episodic",
              "dedup_key": null,
              "last_reinforced_at": null,
              "archived_at": null,
              "created_at": "2026-04-03T09:00:00Z",
              "durable": false,
              "domain": "memory",
              "context_release_policy": "summary_only"
            }
          ],
          "control_changes": [
            {
              "id": "mutation-automation-001",
              "kind": "automation_update",
              "component": "automation",
              "status": "succeeded",
              "summary": "Updated Daily Memory Review",
              "details": "Cadence changed to every day at 9:00 AM.",
              "actor_role": "operator",
              "workspace_id": "preview-workspace",
              "usage": {
                "provider": "openai",
                "model": "gpt-5.4",
                "tokens_in": 128,
                "tokens_out": 256,
                "estimated_cost_usd": 0.012
              },
              "metadata": {
                "automationId": "auto-001"
              },
              "created_at": "2026-04-03T09:15:00Z"
            }
          ],
          "pending_approval_count": 1
        }
        """,
        as: HomeSummaryDTO.self
    )

    static let commandCenterRun: RunRecordDTO = decode(
        """
        {
          "id": "run-001",
          "job_id": "job-001",
          "task_id": "task-001",
          "workspace_id": "preview-workspace",
          "profile_id": "profile-default",
          "session_root_id": "interactive_main:default",
          "engine_session_ref": null,
          "state": "running",
          "started_at": "2026-04-03T08:45:00Z",
          "finished_at": null,
          "error": null
        }
        """,
        as: RunRecordDTO.self
    )

    static let commandCenterJob: JobRecordDTO = decode(
        """
        {
          "id": "job-001",
          "task_id": "task-001",
          "workspace_id": "preview-workspace",
          "status": "running",
          "retry_count": 0,
          "available_at": "2026-04-03T08:45:00Z",
          "last_run_id": "run-001",
          "created_at": "2026-04-03T08:40:00Z",
          "updated_at": "2026-04-03T08:46:00Z"
        }
        """,
        as: JobRecordDTO.self
    )

    static let commandCenterTask: TaskRecordDTO = decode(
        """
        {
          "id": "task-001",
          "workspace_id": "preview-workspace",
          "project_id": null,
          "profile_id": "profile-default",
          "title": "Review operator inbox",
          "prompt": "Review the latest operator tasks.",
          "source": "manual",
          "status": "active",
          "retry_policy": {
            "max_attempts": 3,
            "base_delay_seconds": 30,
            "multiplier": 2,
            "max_delay_seconds": 300
          },
          "side_effect_profile": "read_only",
          "coalesce_key": null,
          "created_at": "2026-04-03T08:39:00Z"
        }
        """,
        as: TaskRecordDTO.self
    )

    static let commandCenterIntervention: InterventionDTO = decode(
        """
        {
          "id": "intervention-001",
          "code": "needs_policy_decision",
          "run_id": "run-001",
          "status": "open",
          "reason": "Operator approval required for external write.",
          "created_at": "2026-04-03T08:50:00Z",
          "resolved_at": null,
          "updated_at": "2026-04-03T08:50:00Z",
          "resolution_note": null
        }
        """,
        as: InterventionDTO.self
    )

    static let dashboardSnapshot = DashboardSnapshot(
        status: daemonStatus,
        scheduler: schedulerStatus,
        capabilities: engineCapabilities,
        usage: usageSummary,
        securityAudit: nil,
        memoryAudit: nil
    )

    static func memorySearchResponse(query: String, results: [MemorySearchHitDTO]) -> MemorySearchResponseDTO {
        decodeData(
            encode(MemorySearchResponsePayload(query: query, results: results, totalCandidates: results.count, latencyMs: 42, searchMode: "hybrid", strategy: "default", traceId: "trace-memory-preview")),
            as: MemorySearchResponseDTO.self
        )
    }

    static func fileSearchResponse(query: String, results: [FileSearchResultDTO]) -> FileSearchResponseDTO {
        decodeData(
            encode(FileSearchResponsePayload(query: query, results: results, totalCandidates: results.count)),
            as: FileSearchResponseDTO.self
        )
    }

    static func financeSearchResponse(query: String, results: [FinanceSearchResultDTO]) -> FinanceSearchResponseDTO {
        decodeData(
            encode(SearchResponsePayload(query: query, results: results)),
            as: FinanceSearchResponseDTO.self
        )
    }

    static func medicalSearchResponse(query: String, results: [MedicalSearchResultDTO]) -> MedicalSearchResponseDTO {
        decodeData(
            encode(SearchResponsePayload(query: query, results: results)),
            as: MedicalSearchResponseDTO.self
        )
    }

    private static func decode<T: Decodable>(_ json: String, as type: T.Type) -> T {
        decodeData(Data(json.utf8), as: type)
    }

    private static func decodeData<T: Decodable>(_ data: Data, as type: T.Type) -> T {
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            fatalError("Failed to decode preview fixture for \(T.self): \(error)")
        }
    }

    private static func encode<T: Encodable>(_ value: T) -> Data {
        let encoder = JSONEncoder()
        do {
            return try encoder.encode(value)
        } catch {
            fatalError("Failed to encode preview fixture payload for \(T.self): \(error)")
        }
    }
}

private struct SearchResponsePayload<Result: Encodable>: Encodable {
    let query: String
    let results: [Result]
}

private struct FileSearchResponsePayload: Encodable {
    let query: String
    let results: [FileSearchResultDTO]
    let totalCandidates: Int
}

private struct MemorySearchResponsePayload<Result: Encodable>: Encodable {
    let query: String
    let results: [Result]
    let totalCandidates: Int
    let latencyMs: Double
    let searchMode: String
    let strategy: String?
    let traceId: String?
}
