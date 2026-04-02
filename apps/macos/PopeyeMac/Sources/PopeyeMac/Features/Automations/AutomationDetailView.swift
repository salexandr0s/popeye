import SwiftUI
import PopeyeAPI

struct AutomationDetailView: View {
    let detail: AutomationDetailDTO
    let mutationReceipt: MutationReceiptDTO?
    let viewMode: AutomationStore.ViewMode
    let update: (Bool?, Int?) -> Void
    let runNow: () -> Void
    let pause: () -> Void
    let resume: () -> Void
    let openRun: (String) -> Void

    @State private var enabled: Bool
    @State private var cadenceText: String

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 4)

    init(
        detail: AutomationDetailDTO,
        mutationReceipt: MutationReceiptDTO?,
        viewMode: AutomationStore.ViewMode,
        update: @escaping (Bool?, Int?) -> Void,
        runNow: @escaping () -> Void,
        pause: @escaping () -> Void,
        resume: @escaping () -> Void,
        openRun: @escaping (String) -> Void
    ) {
        self.detail = detail
        self.mutationReceipt = mutationReceipt
        self.viewMode = viewMode
        self.update = update
        self.runNow = runNow
        self.pause = pause
        self.resume = resume
        self.openRun = openRun
        _enabled = State(initialValue: detail.enabled)
        _cadenceText = State(initialValue: detail.intervalSeconds.map(String.init) ?? "")
    }

    private var parsedCadence: Int? {
        Int(cadenceText.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private var hasPendingChanges: Bool {
        let cadenceChanged = detail.controls.cadenceEdit && parsedCadence != detail.intervalSeconds
        let enabledChanged = detail.controls.enabledEdit && enabled != detail.enabled
        return cadenceChanged || enabledChanged
    }

    private var cadenceValidationMessage: String? {
        guard detail.controls.cadenceEdit else { return nil }
        let trimmed = cadenceText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return "Cadence in seconds is required for this automation." }
        guard let value = Int(trimmed), value > 0 else { return "Cadence must be a positive integer." }
        return nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                summaryCards
                controlsSection
                InspectorSection(title: "Schedule") {
                    DetailRow(label: "Cadence", value: detail.scheduleSummary)
                    DetailRow(label: "Next expected", value: detail.nextExpectedAt.map(DateFormatting.formatAbsoluteTime) ?? "Not scheduled")
                    DetailRow(label: "Workspace", value: detail.workspaceId)
                    DetailRow(label: "Source", value: detail.source.replacingOccurrences(of: "_", with: " ").capitalized)
                }

                if let reason = detail.attentionReason ?? detail.blockedReason {
                    InspectorSection(title: "Why won't this run?") {
                        Label(reason, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                } else {
                    InspectorSection(title: "Why won't this run?") {
                        Text("No blocking signal is visible right now.")
                            .foregroundStyle(.secondary)
                    }
                }

                if let mutationReceipt {
                    InspectorSection(title: "Latest Control Change") {
                        DetailRow(label: "Summary", value: mutationReceipt.summary)
                        DetailRow(label: "Status", value: mutationReceipt.status.replacingOccurrences(of: "_", with: " ").capitalized)
                        DetailRow(label: "When", value: DateFormatting.formatAbsoluteTime(mutationReceipt.createdAt))
                        Text(mutationReceipt.details)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                }

                if viewMode == .list {
                    recentRunsSection
                }
            }
            .padding(20)
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                Text(detail.title)
                    .font(.title2.bold())
                HStack(spacing: 8) {
                    StatusBadge(state: detail.status)
                    Text(detail.scheduleSummary)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            HStack(spacing: 8) {
                if detail.controls.runNow {
                    Button("Run Now", systemImage: "play.fill", action: runNow)
                        .buttonStyle(.borderedProminent)
                }
                if detail.controls.pause {
                    Button("Pause", systemImage: "pause.fill", action: pause)
                        .buttonStyle(.bordered)
                }
                if detail.controls.resume {
                    Button("Resume", systemImage: "playpause.fill", action: resume)
                        .buttonStyle(.bordered)
                }
            }
        }
    }

    private var summaryCards: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            DashboardCard(
                label: "Last Success",
                value: detail.lastSuccessAt.map(DateFormatting.formatRelativeTime) ?? "None",
                description: detail.lastSuccessAt.map(DateFormatting.formatAbsoluteTime)
            )
            DashboardCard(
                label: "Last Failure",
                value: detail.lastFailureAt.map(DateFormatting.formatRelativeTime) ?? "None",
                description: detail.lastFailureAt.map(DateFormatting.formatAbsoluteTime)
            )
            DashboardCard(
                label: "Interventions",
                value: "\(detail.openInterventionCount)",
                description: detail.openInterventionCount == 0 ? "No open interventions" : "Needs operator attention",
                valueColor: detail.openInterventionCount == 0 ? .green : .orange
            )
            DashboardCard(
                label: "Approvals",
                value: "\(detail.pendingApprovalCount)",
                description: detail.pendingApprovalCount == 0 ? "No pending approvals" : "Waiting for approval",
                valueColor: detail.pendingApprovalCount == 0 ? .green : .orange
            )
        }
    }

    private var controlsSection: some View {
        InspectorSection(title: "Controls") {
            VStack(alignment: .leading, spacing: 12) {
                if detail.controls.enabledEdit {
                    Toggle(isOn: $enabled) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Enabled")
                            Text("Disable background execution without losing the automation.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .toggleStyle(.switch)
                }

                if detail.controls.cadenceEdit {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Cadence (seconds)")
                            .font(.headline)
                        TextField("3600", text: $cadenceText)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 160)
                        if let cadenceValidationMessage {
                            Text(cadenceValidationMessage)
                                .font(.caption)
                                .foregroundStyle(.orange)
                        } else {
                            Text(detail.source == "heartbeat"
                                 ? "Heartbeat cadence is saved back to the workspace heartbeat settings."
                                 : "Interval-backed automations can update their cadence directly from here.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                } else {
                    Text("Cadence editing is not available for this automation type.")
                        .foregroundStyle(.secondary)
                }

                if detail.controls.enabledEdit || detail.controls.cadenceEdit {
                    Button("Save Changes") {
                        update(
                            detail.controls.enabledEdit && enabled != detail.enabled ? enabled : nil,
                            detail.controls.cadenceEdit && parsedCadence != detail.intervalSeconds ? parsedCadence : nil
                        )
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(hasPendingChanges == false || cadenceValidationMessage != nil)
                }
            }
        }
    }

    private var recentRunsSection: some View {
        InspectorSection(title: "Recent Runs") {
            if detail.recentRuns.isEmpty {
                Text("This automation has not run yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(detail.recentRuns) { run in
                    Button {
                        openRun(run.id)
                    } label: {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(run.id)
                                    .font(.callout.monospaced())
                                Text(run.startedAt)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if run.pendingApprovalCount > 0 {
                                Text("\(run.pendingApprovalCount) approval")
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                            }
                            if run.openInterventionCount > 0 {
                                Text("\(run.openInterventionCount) intervention")
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                            }
                            StatusBadge(state: run.state)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}
