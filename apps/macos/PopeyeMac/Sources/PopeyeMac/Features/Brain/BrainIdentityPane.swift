import SwiftUI
import PopeyeAPI

struct BrainIdentityPane: View {
    let snapshot: BrainSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
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
        .padding(PopeyeUI.contentPadding)
    }
}
