import SwiftUI
import PopeyeAPI

struct BrainOverviewPane: View {
    let snapshot: BrainSnapshot
    let openMemory: () -> Void
    let openInstructions: () -> Void
    let openAgentProfiles: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
            Text("Assistant Overview")
                .font(.title2.bold())

            LazyVGrid(columns: PopeyeUI.cardColumns(minimum: 180, maximum: 280), spacing: PopeyeUI.cardSpacing) {
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
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) {
                        quickLink("Memory", action: openMemory)
                        quickLink("Instructions", action: openInstructions)
                        quickLink("Agent Profiles", action: openAgentProfiles)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        quickLink("Memory", action: openMemory)
                        quickLink("Instructions", action: openInstructions)
                        quickLink("Agent Profiles", action: openAgentProfiles)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PopeyeUI.contentPadding)
    }

    private func quickLink(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .buttonStyle(.bordered)
    }
}
