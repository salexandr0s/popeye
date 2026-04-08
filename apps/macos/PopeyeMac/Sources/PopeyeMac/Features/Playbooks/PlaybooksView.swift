import SwiftUI
import PopeyeAPI

struct PlaybooksView: View {
    @Bindable var store: PlaybooksStore
    @Environment(AppModel.self) private var appModel

    var body: some View {
        Group {
            if store.loadPhase.isLoading && store.playbooks.isEmpty && store.proposals.isEmpty && store.staleCandidates.isEmpty {
                LoadingStateView(title: "Loading playbooks…")
            } else if let error = store.error,
                      store.playbooks.isEmpty,
                      store.proposals.isEmpty,
                      store.staleCandidates.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                content
            }
        }
        .navigationTitle("Playbooks")
        .searchable(text: $store.searchText, placement: .toolbar, prompt: "Search playbooks and proposals")
        .toolbar {
            ToolbarItemGroup {
                Picker("Mode", selection: $store.mode) {
                    ForEach(PlaybooksStore.Mode.allCases, id: \.self) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(minWidth: 280, idealWidth: 320, maxWidth: 380)

                Button("Refresh", systemImage: "arrow.clockwise") {
                    Task { await store.load() }
                }
                if store.isAuthoring {
                    Button("Save Draft", systemImage: "square.and.arrow.down") {
                        Task { await store.saveAuthoringDraft() }
                    }
                    .disabled(store.mutationState == .executing)

                    Button("Submit", systemImage: "paperplane") {
                        Task { await store.submitAuthoringDraftForReview() }
                    }
                    .disabled(store.mutationState == .executing)

                    Button("Cancel", systemImage: "xmark") {
                        store.cancelAuthoring()
                    }
                    .disabled(store.mutationState == .executing)
                } else if store.mode == .proposals {
                    Button("Edit Draft", systemImage: "square.and.pencil") {
                        store.editSelectedDraft()
                    }
                    .disabled(!store.canEditSelectedDraft || store.mutationState == .executing)

                    Button("Submit", systemImage: "paperplane") {
                        Task { await store.submitSelectedProposalForReview() }
                    }
                    .disabled(store.selectedProposalDetail?.status != "drafting" || store.mutationState == .executing)

                    Button("Approve", systemImage: "checkmark.circle") {
                        Task { await store.approveSelectedProposal() }
                    }
                    .disabled(store.selectedProposalDetail?.status != "pending_review" || store.mutationState == .executing)

                    Button("Reject", systemImage: "xmark.circle") {
                        Task { await store.rejectSelectedProposal() }
                    }
                    .disabled(store.selectedProposalDetail?.status != "pending_review" || store.mutationState == .executing)

                    Button("Apply", systemImage: "wand.and.stars") {
                        Task { await store.applySelectedProposal() }
                    }
                    .disabled(store.selectedProposalDetail?.status != "approved" || store.mutationState == .executing)
                } else {
                    Button("New Draft", systemImage: "doc.badge.plus") {
                        store.startNewDraftAuthoring()
                    }
                    .disabled(store.mutationState == .executing)

                    Button(store.mode == .needsReview ? "Draft Repair" : "Draft Patch", systemImage: "square.and.pencil") {
                        if store.mode == .needsReview {
                            store.startRepairDraftForSelectedCandidate()
                        } else {
                            store.startPatchDraftAuthoring()
                        }
                    }
                    .disabled((store.mode == .needsReview ? !store.canDraftRepairFromSelection : !store.canDraftPatchFromSelection) || store.mutationState == .executing)

                    if store.mode == .playbooks {
                        Button("Suggest Patch", systemImage: "wand.and.stars") {
                            Task { await store.suggestPatchForSelectedPlaybook() }
                        }
                        .disabled(!store.canDraftPatchFromSelection || store.mutationState == .executing)
                    }

                    Button("Activate", systemImage: "checkmark.circle") {
                        Task { await store.activateSelectedPlaybook() }
                    }
                    .disabled(store.selectedPlaybookDetail?.status == "active" || store.mutationState == .executing || store.selectedPlaybookDetail == nil)

                    Button("Retire", systemImage: "xmark.circle") {
                        Task { await store.retireSelectedPlaybook() }
                    }
                    .disabled(store.selectedPlaybookDetail == nil || store.selectedPlaybookDetail?.status == "retired" || store.mutationState == .executing)
                }
            }
        }
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await store.load()
        }
        .onSubmit(of: .search) {
            Task { await store.load() }
        }
        .onChange(of: store.mode) { _, _ in
            Task { await store.didChangeMode() }
        }
        .onChange(of: store.selectedPlaybookRecordID) { oldValue, newValue in
            guard store.mode != .proposals, oldValue != newValue, newValue != nil else { return }
            Task { await store.loadSelectedPlaybookDetail() }
        }
        .onChange(of: store.selectedProposalID) { oldValue, newValue in
            guard store.mode == .proposals, oldValue != newValue, newValue != nil else { return }
            Task { await store.loadSelectedProposalDetail() }
        }
        .popeyeRefreshable(invalidationSignals: [.general]) {
            await store.load()
        }
    }

    private var content: some View {
        HSplitView {
            sidebar
                .popeyeSplitPane(minWidth: 280, idealWidth: 320, maxWidth: 360)

            detailPane
                .popeyeSplitPane(minWidth: 620)
        }
        .overlay(alignment: .bottomTrailing) {
            MutationStateOverlay(state: store.mutationState, dismiss: store.dismissMutation)
                .padding(20)
        }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                Text(appModel.selectedWorkspace?.name ?? appModel.selectedWorkspaceID)
                    .font(.headline)
                Text("Operator-owned procedures, review queue, and stale-repair signals for deterministic instruction behavior.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                summaryCards
                filters
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PopeyeUI.contentPadding)

            Divider()

            switch store.mode {
            case .playbooks:
                if store.playbooks.isEmpty {
                    EmptyStateView(icon: "books.vertical", title: "No playbooks", description: "Canonical playbooks will appear here once they exist.")
                } else {
                    List(store.playbooks, selection: $store.selectedPlaybookRecordID) { playbook in
                        PlaybookRow(playbook: playbook)
                            .tag(playbook.recordId)
                    }
                    .listStyle(.sidebar)
                }
            case .proposals:
                if store.proposals.isEmpty {
                    EmptyStateView(icon: "doc.badge.gearshape", title: "No proposals", description: "Drafts and review-ready proposals will appear here.")
                } else {
                    List(store.proposals, selection: $store.selectedProposalID) { proposal in
                        PlaybookProposalRow(proposal: proposal)
                            .tag(proposal.id)
                    }
                    .listStyle(.sidebar)
                }
            case .needsReview:
                if store.staleCandidates.isEmpty {
                    EmptyStateView(icon: "exclamationmark.bubble", title: "Nothing needs review", description: "Stale or failure-prone playbooks will be surfaced here.")
                } else {
                    List(store.staleCandidates, selection: $store.selectedPlaybookRecordID) { candidate in
                        PlaybookStaleCandidateRow(candidate: candidate)
                            .tag(candidate.recordId)
                    }
                    .listStyle(.sidebar)
                }
            }
        }
    }

    private var summaryCards: some View {
        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 12) {
            GridRow {
                summaryCard(label: "Playbooks", value: "\(store.playbooks.count)")
                summaryCard(label: "Proposals", value: "\(store.proposals.count)")
            }
            GridRow {
                summaryCard(label: "Needs review", value: "\(store.staleCandidates.count)")
                summaryCard(label: "Workspace", value: appModel.selectedWorkspaceID)
            }
        }
    }

    @ViewBuilder
    private var filters: some View {
        switch store.mode {
        case .playbooks:
            HStack {
                Picker("Scope", selection: $store.playbookScopeFilter) {
                    Text("All scopes").tag("all")
                    Text("Global").tag("global")
                    Text("Workspace").tag("workspace")
                    Text("Project").tag("project")
                }
                Picker("Status", selection: $store.playbookStatusFilter) {
                    Text("All statuses").tag("all")
                    Text("Draft").tag("draft")
                    Text("Active").tag("active")
                    Text("Retired").tag("retired")
                }
            }
            .labelsHidden()
            .onChange(of: store.playbookScopeFilter) { _, _ in Task { await store.load() } }
            .onChange(of: store.playbookStatusFilter) { _, _ in Task { await store.load() } }
        case .proposals:
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Picker("Status", selection: $store.proposalStatusFilter) {
                        Text("All").tag("all")
                        Text("Drafting").tag("drafting")
                        Text("Pending").tag("pending_review")
                        Text("Approved").tag("approved")
                        Text("Applied").tag("applied")
                        Text("Rejected").tag("rejected")
                    }
                    Picker("Kind", selection: $store.proposalKindFilter) {
                        Text("All").tag("all")
                        Text("Draft").tag("draft")
                        Text("Patch").tag("patch")
                    }
                }
                Picker("Scope", selection: $store.proposalScopeFilter) {
                    Text("All scopes").tag("all")
                    Text("Global").tag("global")
                    Text("Workspace").tag("workspace")
                    Text("Project").tag("project")
                }
            }
            .labelsHidden()
            .onChange(of: store.proposalStatusFilter) { _, _ in Task { await store.load() } }
            .onChange(of: store.proposalKindFilter) { _, _ in Task { await store.load() } }
            .onChange(of: store.proposalScopeFilter) { _, _ in Task { await store.load() } }
        case .needsReview:
            EmptyView()
        }
    }

    private func summaryCard(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title3.weight(.semibold))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
    }

    private var detailPane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                if let error = store.detailError {
                    Text(error.userMessage)
                        .font(.callout)
                        .foregroundStyle(.red)
                }

                if store.isAuthoring {
                    PlaybookProposalEditorView(store: store)
                } else {
                    switch store.mode {
                    case .playbooks, .needsReview:
                        playbookDetail
                    case .proposals:
                        proposalDetail
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PopeyeUI.contentPadding)
        }
    }

    @ViewBuilder
    private var playbookDetail: some View {
        if store.detailPhase.isLoading && store.selectedPlaybookDetail == nil {
            LoadingStateView(title: "Loading playbook…")
        } else if let playbook = store.selectedPlaybookDetail {
            if let stale = store.selectedStaleCandidate {
                GroupBox("Needs review") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(stale.reasons, id: \.self) { reason in
                            Label(reason, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.orange)
                        }
                        HStack {
                            Button("Draft Repair", systemImage: "square.and.pencil") {
                                store.startRepairDraftForSelectedCandidate()
                            }
                            .disabled(store.mutationState == .executing)

                            Spacer()
                        }
                        .padding(.top, 4)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            GroupBox(playbook.title) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        StatusBadge(state: playbook.status)
                        StatusBadge(state: playbook.scope)
                    }
                    LabeledContent("Playbook ID", value: playbook.playbookId)
                    LabeledContent("Updated", value: DateFormatting.formatRelativeTime(playbook.updatedAt))
                    LabeledContent("Revision", value: playbook.currentRevisionHash)
                    LabeledContent("Profiles", value: playbook.allowedProfileIds.isEmpty ? "all profiles" : playbook.allowedProfileIds.joined(separator: ", "))
                    LabeledContent("Indexed memory", value: playbook.indexedMemoryId ?? "not indexed")
                    HStack {
                        Button("Draft Patch", systemImage: "square.and.pencil") {
                            store.startPatchDraftAuthoring()
                        }
                        .disabled(store.mutationState == .executing)

                        Button("Suggest Patch", systemImage: "wand.and.stars") {
                            Task { await store.suggestPatchForSelectedPlaybook() }
                        }
                        .disabled(store.mutationState == .executing)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if let effectiveness = playbook.effectiveness {
                GroupBox("Effectiveness") {
                    Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 12) {
                        GridRow {
                            summaryCard(label: "Uses (30d)", value: "\(effectiveness.useCount30d)")
                            summaryCard(label: "Success", value: percent(effectiveness.successRate30d))
                        }
                        GridRow {
                            summaryCard(label: "Failure", value: percent(effectiveness.failureRate30d))
                            summaryCard(label: "Intervention", value: percent(effectiveness.interventionRate30d))
                        }
                    }
                }
            }

            GroupBox("Canonical markdown") {
                MarkdownPreviewView(markdown: playbook.markdownText)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            GroupBox("Revisions") {
                if store.revisions.isEmpty {
                    Text("No revisions yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(store.revisions) { revision in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(revision.title)
                                    .font(.headline)
                                Spacer()
                                if revision.current {
                                    StatusBadge(state: "current")
                                }
                            }
                            Text(revision.revisionHash)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                            Text(DateFormatting.formatRelativeTime(revision.createdAt))
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }

            GroupBox("Recent usage") {
                if store.usage.isEmpty {
                    Text("No recent usage.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(store.usage) { usage in
                        Button {
                            appModel.navigateToRun(id: usage.runId)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(usage.runId)
                                        .font(.headline)
                                    Text(DateFormatting.formatRelativeTime(usage.startedAt))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                StatusBadge(state: usage.runState)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .padding(.vertical, 4)
                    }
                }
            }
        } else {
            EmptyStateView(icon: "books.vertical", title: "Select a playbook", description: "Canonical playbook details will appear here.")
                .frame(maxWidth: .infinity, minHeight: 360)
        }
    }

    @ViewBuilder
    private var proposalDetail: some View {
        if store.detailPhase.isLoading && store.selectedProposalDetail == nil {
            LoadingStateView(title: "Loading proposal…")
        } else if let proposal = store.selectedProposalDetail {
            GroupBox(proposal.title) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        StatusBadge(state: proposal.status)
                        StatusBadge(state: proposal.kind)
                        StatusBadge(state: proposal.scanVerdict)
                    }
                    LabeledContent("Playbook", value: proposal.playbookId)
                    LabeledContent("Target", value: proposal.targetRecordId ?? "new draft")
                    LabeledContent("Scope", value: proposal.scope)
                    LabeledContent("Source", value: proposal.proposedBy)
                    if let sourceRunId = proposal.sourceRunId {
                        Button(sourceRunId) {
                            appModel.navigateToRun(id: sourceRunId)
                        }
                        .buttonStyle(.link)
                    }
                    if let reviewedBy = proposal.reviewedBy {
                        LabeledContent("Reviewed by", value: reviewedBy)
                    }
                    if let reviewNote = proposal.reviewNote, !reviewNote.isEmpty {
                        Text(reviewNote)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    if proposal.status == "drafting" {
                        Button("Edit Draft", systemImage: "square.and.pencil") {
                            store.editSelectedDraft()
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if let evidence = proposal.evidence {
                GroupBox("Evidence") {
                    VStack(alignment: .leading, spacing: 12) {
                        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 12) {
                            GridRow {
                                summaryCard(label: "Uses (30d)", value: "\(evidence.metrics30d.useCount30d)")
                                summaryCard(label: "Failed runs", value: "\(evidence.metrics30d.failedRuns30d)")
                            }
                            GridRow {
                                summaryCard(label: "Interventions", value: "\(evidence.metrics30d.interventions30d)")
                                summaryCard(label: "Last problem", value: evidence.lastProblemAt.map(DateFormatting.formatRelativeTime) ?? "—")
                            }
                        }
                        if !evidence.suggestedPatchNote.isEmpty {
                            Text(evidence.suggestedPatchNote)
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            if !proposal.diffPreview.isEmpty {
                GroupBox("Diff preview") {
                    Text(proposal.diffPreview)
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            GroupBox("Proposed markdown") {
                MarkdownPreviewView(markdown: proposal.markdownText)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            EmptyStateView(icon: "doc.badge.gearshape", title: "Select a proposal", description: "Proposal review details will appear here.")
                .frame(maxWidth: .infinity, minHeight: 360)
        }
    }

    private func percent(_ value: Double) -> String {
        "\(Int((value * 100).rounded()))%"
    }

    private func reload() {
        Task { await store.load() }
    }
}

private struct PlaybookProposalEditorView: View {
    @Bindable var store: PlaybooksStore

    var body: some View {
        if let editor = store.editor {
            VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                GroupBox(editorTitle(editor)) {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 10) {
                            StatusBadge(state: editor.kind)
                            if let status = editor.proposalStatus {
                                StatusBadge(state: status)
                            }
                            if editor.isDraft {
                                StatusBadge(state: editor.scope)
                            }
                        }
                        LabeledContent("Context", value: editor.sourceLabel)
                        if editor.isPatch {
                            LabeledContent("Target record", value: editor.targetRecordId ?? "—")
                            LabeledContent("Base revision", value: editor.baseRevisionHash ?? "—")
                        } else {
                            LabeledContent("Selected workspace", value: editor.workspaceId.isEmpty ? "global" : editor.workspaceId)
                        }
                        if editor.canUseSuggestedSeed {
                            Button("Seed Suggested Patch", systemImage: "wand.and.stars") {
                                Task { await store.suggestPatchForSelectedPlaybook() }
                            }
                            .disabled(store.mutationState == .executing)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                if let errorMessage = store.editorErrorMessage ?? store.editorValidationMessage {
                    Text(errorMessage)
                        .font(.callout)
                        .foregroundStyle(.red)
                }

                GroupBox("Proposal details") {
                    VStack(alignment: .leading, spacing: 12) {
                        if editor.isDraft {
                            TextField("Playbook ID", text: playbookIDBinding)
                            Picker("Scope", selection: scopeBinding) {
                                Text("Global").tag("global")
                                Text("Workspace").tag("workspace")
                                Text("Project").tag("project")
                            }
                            if editor.scope != "global" {
                                if workspaceOptions.isEmpty {
                                    LabeledContent("Workspace", value: editor.workspaceId)
                                } else {
                                    Picker("Workspace", selection: workspaceBinding) {
                                        ForEach(workspaceOptions) { workspace in
                                            Text(workspace.name).tag(workspace.id)
                                        }
                                    }
                                }
                            }
                            if editor.scope == "project" {
                                if store.availableProjectsForEditor.isEmpty {
                                    Text("No projects are registered for the selected workspace.")
                                        .font(.callout)
                                        .foregroundStyle(.secondary)
                                } else {
                                    Picker("Project", selection: projectBinding) {
                                        ForEach(store.availableProjectsForEditor) { project in
                                            Text(project.name).tag(project.id)
                                        }
                                    }
                                }
                            }
                        }

                        TextField("Title", text: titleBinding)
                        TextField("Allowed profiles", text: allowedProfilesBinding, prompt: Text("default, reviewer"))
                        TextField("Summary", text: summaryBinding, axis: .vertical)
                            .lineLimit(2...5)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                GroupBox("Markdown body") {
                    MacMarkdownEditor(text: bodyBinding)
                        .frame(minHeight: 260)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .strokeBorder(.quaternary, lineWidth: 1)
                        )
                }

                GroupBox("Preview") {
                    MarkdownPreviewView(markdown: editor.body)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                HStack {
                    Button("Save Draft", systemImage: "square.and.arrow.down") {
                        Task { await store.saveAuthoringDraft() }
                    }
                    .disabled(store.mutationState == .executing)

                    Button("Submit for Review", systemImage: "paperplane") {
                        Task { await store.submitAuthoringDraftForReview() }
                    }
                    .disabled(store.mutationState == .executing)

                    Spacer()

                    if store.isEditorDirty {
                        Text("Unsaved changes")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Button("Cancel", systemImage: "xmark") {
                        store.cancelAuthoring()
                    }
                    .disabled(store.mutationState == .executing)
                }
            }
        }
    }

    private var workspaceOptions: [WorkspaceRecordDTO] {
        if store.workspaces.isEmpty, let editor = store.editor, !editor.workspaceId.isEmpty {
            return [WorkspaceRecordDTO(id: editor.workspaceId, name: editor.workspaceId, rootPath: nil, createdAt: "")]
        }
        return store.workspaces
    }

    private func editorTitle(_ editor: PlaybooksStore.ProposalEditor) -> String {
        switch editor.sessionKind {
        case .newDraft:
            return "New Draft Proposal"
        case .newPatch:
            return "New Patch Proposal"
        case .editDraft:
            return "Edit Draft Proposal"
        }
    }

    private var titleBinding: Binding<String> {
        Binding(
            get: { store.editor?.title ?? "" },
            set: { store.updateEditorTitle($0) }
        )
    }

    private var playbookIDBinding: Binding<String> {
        Binding(
            get: { store.editor?.playbookId ?? "" },
            set: { store.updateEditorPlaybookID($0) }
        )
    }

    private var allowedProfilesBinding: Binding<String> {
        Binding(
            get: { store.editor?.allowedProfileIdsText ?? "" },
            set: { store.updateEditorAllowedProfilesText($0) }
        )
    }

    private var summaryBinding: Binding<String> {
        Binding(
            get: { store.editor?.summary ?? "" },
            set: { store.updateEditorSummary($0) }
        )
    }

    private var bodyBinding: Binding<String> {
        Binding(
            get: { store.editor?.body ?? "" },
            set: { store.updateEditorBody($0) }
        )
    }

    private var scopeBinding: Binding<String> {
        Binding(
            get: { store.editor?.scope ?? "workspace" },
            set: { store.updateEditorScope($0) }
        )
    }

    private var workspaceBinding: Binding<String> {
        Binding(
            get: { store.editor?.workspaceId ?? store.workspaceID },
            set: { store.updateEditorWorkspaceID($0) }
        )
    }

    private var projectBinding: Binding<String> {
        Binding(
            get: { store.editor?.projectId ?? "" },
            set: { store.updateEditorProjectID($0) }
        )
    }
}

private struct PlaybookRow: View {
    let playbook: PlaybookRecordDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(playbook.title)
                .font(.headline)
            Text(playbook.recordId)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
            HStack(spacing: 8) {
                StatusBadge(state: playbook.scope)
                StatusBadge(state: playbook.status)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct PlaybookProposalRow: View {
    let proposal: PlaybookProposalDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(proposal.title)
                .font(.headline)
            Text(proposal.playbookId)
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                StatusBadge(state: proposal.kind)
                StatusBadge(state: proposal.status)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct PlaybookStaleCandidateRow: View {
    let candidate: PlaybookStaleCandidateDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(candidate.title)
                .font(.headline)
            Text(candidate.recordId)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
            if let reason = candidate.reasons.first {
                Text(reason)
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
    }
}
