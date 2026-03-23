import SwiftUI
import PopeyeAPI

struct AgentProfileInspectorView: View {
    let profile: AgentProfileDTO

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerSection
                scopesSection
                permissionsSection
                policySection
                timestampsSection
            }
            .padding(16)
        }
    }

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(profile.name)
                    .font(.title3.bold())
                StatusBadge(state: profile.mode)
            }
            CopyableRow(label: "ID", value: profile.id)
            if !profile.description.isEmpty {
                DetailRow(label: "Description", value: profile.description)
            }
        }
    }

    private var scopesSection: some View {
        InspectorSection(title: "Scopes") {
            DetailRow(label: "Memory Scope", value: profile.memoryScope)
            DetailRow(label: "Recall Scope", value: profile.recallScope)
            DetailRow(label: "Filesystem Policy", value: profile.filesystemPolicyClass)
            DetailRow(label: "Context Release", value: profile.contextReleasePolicy)
        }
    }

    private var permissionsSection: some View {
        InspectorSection(title: "Permissions") {
            if profile.allowedRuntimeTools.isEmpty {
                Text("No runtime tools")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(profile.allowedRuntimeTools, id: \.self) { tool in
                    Label(tool, systemImage: "wrench")
                        .font(.caption)
                }
            }

            Divider()

            if profile.allowedCapabilityIds.isEmpty {
                Text("No capabilities")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(profile.allowedCapabilityIds, id: \.self) { cap in
                    Label(cap, systemImage: "checkmark.seal")
                        .font(.caption)
                }
            }
        }
    }

    private var policySection: some View {
        InspectorSection(title: "Policy") {
            DetailRow(label: "Model Policy", value: profile.modelPolicy)
        }
    }

    private var timestampsSection: some View {
        InspectorSection(title: "Timestamps") {
            DetailRow(label: "Created", value: DateFormatting.formatAbsoluteTime(profile.createdAt))
            if let updated = profile.updatedAt {
                DetailRow(label: "Updated", value: DateFormatting.formatAbsoluteTime(updated))
            }
        }
    }

}
