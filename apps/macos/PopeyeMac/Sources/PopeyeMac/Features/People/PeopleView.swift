import SwiftUI
import PopeyeAPI

struct PeopleView: View {
    @Bindable var store: PeopleStore
    @State private var debouncer = ReloadDebouncer()

    var body: some View {
        Group {
            if store.isLoading && store.people.isEmpty {
                LoadingStateView(title: "Loading people…")
            } else if let error = store.error, store.people.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                HSplitView {
                    sidebar
                        .frame(minWidth: 280, idealWidth: 320, maxWidth: 360)
                    detail
                        .frame(minWidth: 560)
                }
            }
        }
        .navigationTitle("People")
        .task { await store.load() }
        .onChange(of: store.selectedPersonID) { _, newValue in
            guard let newValue else { return }
            Task { await store.loadPerson(id: newValue) }
        }
        .onChange(of: store.searchText) { _, _ in
            store.ensureSelection()
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task { await store.load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal, [.general, .connections].contains(signal) {
                debouncer.schedule { [store] in await store.load() }
            }
        }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                TextField("Search people", text: $store.searchText)
                    .textFieldStyle(.roundedBorder)
                Text("\(store.mergeSuggestions.count) merge suggestion\(store.mergeSuggestions.count == 1 ? "" : "s") visible")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(16)

            Divider()

            if store.filteredPeople.isEmpty {
                EmptyStateView(icon: "person.crop.circle.badge.2", title: "No people found", description: "People will appear here as Popeye builds relationship context across your domains.")
            } else {
                List(store.filteredPeople, selection: $store.selectedPersonID) { person in
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
                    .tag(person.id)
                }
                .listStyle(.sidebar)
            }
        }
    }

    private var detail: some View {
        ScrollView {
            if let person = store.selectedPerson {
                VStack(alignment: .leading, spacing: 20) {
                    header(for: person)
                    mutationBanner

                    InspectorSection(title: "Relationship") {
                        DetailRow(label: "Email", value: person.canonicalEmail ?? "Not set")
                        DetailRow(label: "GitHub", value: person.githubLogin ?? "Not set")
                        DetailRow(label: "Tags", value: person.tags.isEmpty ? "None" : person.tags.joined(separator: ", "))
                        if let policy = person.policy {
                            DetailRow(label: "Relationship", value: policy.relationshipLabel ?? "Not set")
                            DetailRow(label: "Reminder Routing", value: policy.reminderRouting ?? "Not set")
                        }
                        if person.notes.isEmpty == false {
                            Text(person.notes)
                                .foregroundStyle(.secondary)
                        }
                    }

                    InspectorSection(title: "Identities") {
                        if person.identities.isEmpty {
                            Text("No linked identities")
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(person.identities) { identity in
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack(alignment: .top) {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(identity.provider.capitalized)
                                                .font(.headline)
                                            Text(identity.displayName ?? identity.externalId)
                                                .foregroundStyle(.secondary)
                                            if let handle = identity.handle {
                                                Text(handle)
                                                    .font(.caption)
                                                    .foregroundStyle(.tertiary)
                                            }
                                        }
                                        Spacer()
                                        Button("Detach", role: .destructive) {
                                            Task { await store.detachIdentity(identity.id) }
                                        }
                                        .buttonStyle(.bordered)
                                        .disabled(store.isMutating)
                                    }
                                }
                                if identity.id != person.identities.last?.id {
                                    Divider()
                                }
                            }
                        }

                        Divider()

                        VStack(alignment: .leading, spacing: 10) {
                            Text("Attach Identity")
                                .font(.headline)
                            Picker("Provider", selection: $store.attachProvider) {
                                Text("Email").tag("email")
                                Text("Calendar").tag("calendar")
                                Text("GitHub").tag("github")
                            }
                            .pickerStyle(.segmented)
                            .frame(maxWidth: 320)

                            TextField("External ID", text: $store.attachExternalID)
                                .textFieldStyle(.roundedBorder)
                            TextField("Display Name (optional)", text: $store.attachDisplayName)
                                .textFieldStyle(.roundedBorder)
                            TextField("Handle (optional)", text: $store.attachHandle)
                                .textFieldStyle(.roundedBorder)

                            Button("Attach Identity") {
                                Task { await store.attachIdentity() }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(store.canAttachIdentity == false || store.isMutating)
                        }
                    }

                    InspectorSection(title: "Contact Methods") {
                        if person.contactMethods.isEmpty {
                            Text("No contact methods recorded")
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(person.contactMethods) { method in
                                DetailRow(label: method.type.capitalized, value: method.value)
                            }
                        }
                    }

                    InspectorSection(title: "Activity") {
                        if store.personActivity.isEmpty {
                            Text("No recent rollups for this person yet.")
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(store.personActivity) { activity in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(activity.domain.capitalized)
                                            .font(.headline)
                                        Spacer()
                                        Text("\(activity.count)")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Text(activity.summary)
                                        .foregroundStyle(.secondary)
                                    Text(DateFormatting.formatRelativeTime(activity.lastSeenAt))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }

                    InspectorSection(title: "Repair") {
                        if person.identities.count < 2 {
                            Text("Split becomes available when a person record has at least two linked identities.")
                                .foregroundStyle(.secondary)
                        } else {
                            Text("Select the identities that should move into a new person record.")
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            ForEach(person.identities) { identity in
                                Toggle(isOn: Binding(
                                    get: { store.splitIdentityIDs.contains(identity.id) },
                                    set: { store.setSplitIdentity(identity.id, selected: $0) }
                                )) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(identity.displayName ?? identity.externalId)
                                        Text(identity.provider.capitalized)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .toggleStyle(.checkbox)
                            }

                            TextField("New person display name (optional)", text: $store.splitDisplayName)
                                .textFieldStyle(.roundedBorder)
                                .frame(maxWidth: 320)

                            Button("Split Selected Identities") {
                                Task { await store.splitSelectedIdentities() }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(store.canSplitSelection == false || store.isMutating)
                        }
                    }

                    InspectorSection(title: "Merge Signals") {
                        if store.selectedSuggestions.isEmpty && store.mergeEvents.isEmpty {
                            Text("No merge suggestions or merge history for this person.")
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(store.selectedSuggestions) { suggestion in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack(alignment: .top) {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text("Possible duplicate: \(suggestion.sourceDisplayName) ↔ \(suggestion.targetDisplayName)")
                                                .font(.headline)
                                            Text(suggestion.reason)
                                                .foregroundStyle(.secondary)
                                            Text("Confidence \((suggestion.confidence * 100).formatted(.number.precision(.fractionLength(0))))%")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Button("Merge") {
                                            Task { await store.merge(suggestion) }
                                        }
                                        .buttonStyle(.borderedProminent)
                                        .disabled(store.isMutating)
                                    }
                                }
                            }
                            ForEach(store.mergeEvents) { event in
                                DetailRow(label: event.eventType.replacingOccurrences(of: "_", with: " ").capitalized, value: DateFormatting.formatAbsoluteTime(event.createdAt))
                            }
                        }
                    }
                }
                .padding(20)
            } else {
                ContentUnavailableView("Select a person", systemImage: "person.crop.circle.badge.2")
                    .frame(maxWidth: .infinity, minHeight: 320)
            }
        }
    }

    private func header(for person: PersonDTO) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                Text(person.displayName)
                    .font(.title2.bold())
                Text(person.activitySummary)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            HStack(spacing: 12) {
                DashboardCard(label: "Identities", value: "\(person.identityCount)")
                DashboardCard(label: "Contacts", value: "\(person.contactMethodCount)")
            }
            .frame(maxWidth: 320)
        }
    }

    @ViewBuilder
    private var mutationBanner: some View {
        if let message = store.mutationMessage {
            Label(message, systemImage: "checkmark.circle.fill")
                .font(.callout)
                .foregroundStyle(.green)
        } else if let message = store.mutationErrorMessage {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.callout)
                .foregroundStyle(.orange)
        }
    }

    private func reload() {
        Task { await store.load() }
    }
}
