import SwiftUI
import PopeyeAPI

struct PeopleRepairSection: View {
    @Bindable var store: PeopleStore
    let person: PersonDTO

    var body: some View {
        InspectorSection(title: "Repair") {
            if person.identities.count < 2 {
                Text("Split becomes available when a person record has at least two linked identities.")
                    .foregroundStyle(.secondary)
            } else {
                Text("Select the identities that should move into a new person record.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                ForEach(person.identities) { identity in
                    Toggle(isOn: selectionBinding(for: identity.id)) {
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
    }

    private func selectionBinding(for identityID: String) -> Binding<Bool> {
        Binding(
            get: { store.splitIdentityIDs.contains(identityID) },
            set: { store.setSplitIdentity(identityID, selected: $0) }
        )
    }
}
