import SwiftUI
import PopeyeAPI

struct AgentProfilesView: View {
    @Bindable var store: AgentProfilesStore

    var body: some View {
        Group {
            if store.isLoading && store.profiles.isEmpty {
                LoadingStateView(title: "Loading agent profiles...")
            } else if store.profiles.isEmpty {
                EmptyStateView(
                    icon: "person.2",
                    title: "No agent profiles",
                    description: "Agent profiles define execution permissions and scopes."
                )
            } else {
                profilesContent
            }
        }
        .navigationTitle("Agent Profiles")
        .searchable(text: $store.searchText, placement: .toolbar, prompt: "Filter profiles…")
        .task {
            await store.load()
        }
        .popeyeRefreshable(invalidationSignals: [.general]) {
            await store.load()
        }
    }

    private var profilesContent: some View {
        HSplitView {
            profilesList
                .frame(minWidth: 300)
            inspectorColumn
                .frame(minWidth: 300)
        }
    }

    private var profilesList: some View {
        List(store.filteredProfiles, selection: $store.selectedProfileId) { profile in
            AgentProfileRowView(profile: profile)
        }
        .listStyle(.inset)
    }

    @ViewBuilder
    private var inspectorColumn: some View {
        if let profile = store.selectedProfile {
            AgentProfileInspectorView(profile: profile)
        } else {
            Text("Select a profile to inspect")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct AgentProfileRowView: View {
    let profile: AgentProfileDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(profile.name)
                    .font(.body.weight(.medium))
                Spacer()
                StatusBadge(state: profile.mode)
            }
            if !profile.description.isEmpty {
                Text(profile.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
    }

}
