import SwiftUI
import PopeyeAPI

struct PeopleSidebar: View {
    @Bindable var store: PeopleStore

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Text("People")
                    .font(.headline)
                Text("\(store.filteredPeople.count) people shown")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Text("\(store.mergeSuggestions.count) merge suggestion\(store.mergeSuggestions.count == 1 ? "" : "s") visible")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PopeyeUI.contentPadding)

            Divider()

            if store.filteredPeople.isEmpty {
                EmptyStateView(
                    icon: "person.crop.circle.badge.2",
                    title: "No people found",
                    description: "People will appear here as Popeye builds relationship context across your domains."
                )
            } else {
                List(store.filteredPeople, selection: $store.selectedPersonID) { person in
                    personRow(for: person)
                        .tag(person.id)
                }
                .listStyle(.sidebar)
            }
        }
    }

    private func personRow(for person: PersonDTO) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(person.displayName)
                .font(.headline)
            Text(person.activitySummary)
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            HStack(spacing: 8) {
                if let email = person.canonicalEmail {
                    Text(email)
                }
                if let githubLogin = person.githubLogin {
                    Text(githubLogin)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}
