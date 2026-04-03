import SwiftUI
import PopeyeAPI

struct ControlChangeDetailSheet: View {
    let receipt: MutationReceiptDTO

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    InspectorSection(title: "Summary") {
                        DetailRow(label: "Kind", value: formattedValue(receipt.kind))
                        DetailRow(label: "Component", value: receipt.component.capitalized)
                        DetailRow(label: "Status", value: formattedValue(receipt.status))
                        DetailRow(label: "Actor", value: receipt.actorRole.capitalized)
                        DetailRow(label: "When", value: DateFormatting.formatAbsoluteTime(receipt.createdAt))

                        if let workspaceId = receipt.workspaceId {
                            DetailRow(label: "Workspace", value: workspaceId)
                        }
                    }

                    InspectorSection(title: "Details") {
                        Text(receipt.details)
                            .textSelection(.enabled)
                    }

                    if receipt.metadata.isEmpty == false {
                        InspectorSection(title: "Metadata") {
                            ForEach(receipt.metadata.keys.sorted(), id: \.self) { key in
                                DetailRow(label: key, value: receipt.metadata[key] ?? "")
                            }
                        }
                    }
                }
                .padding(20)
            }
            .navigationTitle("Control Change")
        }
        .frame(minWidth: 480, minHeight: 420)
    }

    private func formattedValue(_ value: String) -> String {
        value.replacingOccurrences(of: "_", with: " ").capitalized
    }
}
