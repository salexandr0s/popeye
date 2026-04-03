import SwiftUI
import PopeyeAPI

struct PeopleIdentitiesSection: View {
    @Bindable var store: PeopleStore
    let person: PersonDTO

    var body: some View {
        InspectorSection(title: "Identities") {
            if person.identities.isEmpty {
                Text("No linked identities")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(person.identities) { identity in
                    identityRow(identity)
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
    }

    private func identityRow(_ identity: PersonIdentityDTO) -> some View {
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
}
