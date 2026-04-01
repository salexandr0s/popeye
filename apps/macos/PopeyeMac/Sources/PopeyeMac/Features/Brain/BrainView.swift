import SwiftUI
import PopeyeAPI

struct BrainView: View {
    @Bindable var store: BrainStore
    @Environment(AppModel.self) private var appModel
    @State private var debouncer = ReloadDebouncer()

    var body: some View {
        Group {
            if store.isLoading && store.preview == nil && store.identities.isEmpty {
                LoadingStateView(title: "Loading brain…")
            } else if let error = store.error, store.preview == nil {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                brainContent
            }
        }
        .navigationTitle("Brain")
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await store.load()
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task { await store.load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal, [.general, .memory].contains(signal) {
                debouncer.schedule { [store] in await store.load() }
            }
        }
    }

    private var brainContent: some View {
        HSplitView {
            BrainSidebarView(selection: $store.selectedPane)
                .frame(minWidth: 220, idealWidth: 240, maxWidth: 280)

            ScrollView {
                switch store.selectedPane ?? .overview {
                case .overview:
                    BrainOverviewPane(snapshot: store.snapshot, appModel: appModel)
                case .identity:
                    BrainIdentityPane(snapshot: store.snapshot)
                case .composition:
                    BrainCompositionPane(snapshot: store.snapshot, openInstructions: appModel.navigateToInstructions)
                }
            }
            .frame(minWidth: 520)
        }
    }

    private func reload() {
        Task { await store.load() }
    }
}

private struct BrainOverviewPane: View {
    let snapshot: BrainSnapshot
    let appModel: AppModel

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 2)

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Assistant Overview")
                .font(.title2.bold())

            LazyVGrid(columns: columns, spacing: 12) {
                DashboardCard(
                    label: "Active Identity",
                    value: snapshot.activeIdentityID,
                    description: snapshot.activeIdentityRecord?.path ?? "Workspace default identity"
                )
                DashboardCard(
                    label: "Soul",
                    value: snapshot.soulSource == nil ? "Missing" : "Loaded",
                    description: snapshot.soulSource?.path ?? snapshot.soulSource?.inlineId ?? "No soul overlay in this bundle",
                    valueColor: snapshot.soulSource == nil ? .orange : .green
                )
                DashboardCard(
                    label: "Instruction Sources",
                    value: "\(snapshot.sortedSources.count)",
                    description: snapshot.warnings.isEmpty ? "No preview warnings" : "\(snapshot.warnings.count) warning\(snapshot.warnings.count == 1 ? "" : "s")"
                )
                DashboardCard(
                    label: "Applied Playbooks",
                    value: "\(snapshot.playbooks.count)",
                    description: snapshot.playbooks.first?.title ?? "No active playbooks in this preview"
                )
            }

            if !snapshot.warnings.isEmpty {
                InspectorSection(title: "Warnings") {
                    ForEach(snapshot.warnings, id: \.self) { warning in
                        Label(warning, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                }
            }

            InspectorSection(title: "Quick Links") {
                HStack(spacing: 12) {
                    Button("Memory") {
                        appModel.navigateToMemory(preferredMode: .daily)
                    }
                    Button("Instructions") {
                        appModel.navigateToInstructions()
                    }
                    Button("Agent Profiles") {
                        appModel.navigateToAgentProfiles()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
    }
}

private struct BrainIdentityPane: View {
    let snapshot: BrainSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Identity & Soul")
                .font(.title2.bold())

            InspectorSection(title: "Active Identity") {
                DetailRow(label: "Identity ID", value: snapshot.activeIdentityID)
                if let activeIdentityRecord = snapshot.activeIdentityRecord {
                    DetailRow(label: "Path", value: activeIdentityRecord.path)
                    DetailRow(label: "Selected", value: activeIdentityRecord.selected ? "Yes" : "No")
                    DetailRow(label: "Exists", value: activeIdentityRecord.exists ? "Yes" : "No")
                } else {
                    DetailRow(label: "Status", value: "Using workspace default fallback")
                }
            }

            InspectorSection(title: "Available Identities") {
                if snapshot.identities.isEmpty {
                    Text("No identities were returned by the control API.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(snapshot.identities) { identity in
                        HStack {
                            Text(identity.id)
                            Spacer()
                            StatusBadge(state: identity.selected ? "connected" : "idle")
                        }
                    }
                }
            }

            InspectorSection(title: "Soul Overlay") {
                if let soulSource = snapshot.soulSource {
                    DetailRow(label: "Source", value: soulSource.path ?? soulSource.inlineId ?? "Inline source")
                    DetailRow(label: "Precedence", value: "P\(soulSource.precedence)")
                } else {
                    Text("No soul instruction source is present in the current compiled bundle.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
    }
}

private struct BrainCompositionPane: View {
    let snapshot: BrainSnapshot
    let openInstructions: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text("Instruction Composition")
                    .font(.title2.bold())
                Spacer()
                Button("Open Full Preview", action: openInstructions)
                    .buttonStyle(.borderedProminent)
            }

            if !snapshot.playbooks.isEmpty {
                InspectorSection(title: "Applied Playbooks") {
                    ForEach(snapshot.playbooks) { playbook in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(playbook.title)
                                Text(playbook.id)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            StatusBadge(state: playbook.scope)
                        }
                    }
                }
            }

            InspectorSection(title: "Sources by Type") {
                if snapshot.sourceGroups.isEmpty {
                    Text("No instruction sources are loaded.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(snapshot.sourceGroups) { group in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(group.type.replacingOccurrences(of: "_", with: " ").capitalized)
                                Spacer()
                                Text("\(group.sources.count)")
                                    .foregroundStyle(.secondary)
                            }
                            ForEach(group.sources) { source in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        StatusBadge(state: "P\(source.precedence)")
                                        if let path = source.path {
                                            Text(path)
                                                .foregroundStyle(.secondary)
                                        } else if let inlineID = source.inlineId {
                                            Text(inlineID)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    Text(source.content)
                                        .lineLimit(3)
                                        .foregroundStyle(.secondary)
                                }
                                .padding(.vertical, 4)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
    }
}
