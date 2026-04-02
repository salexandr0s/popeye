import SwiftUI
import PopeyeAPI

struct ControlChangesSection: View {
    let receipts: [MutationReceiptDTO]
    @State private var selectedReceipt: MutationReceiptDTO?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Recent Control Changes")
                .font(.headline)
                .foregroundStyle(.secondary)

            if receipts.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "slider.horizontal.3")
                        .foregroundStyle(.secondary)
                    Text("No recent control-plane changes")
                        .foregroundStyle(.secondary)
                }
                .font(.callout)
                .padding(.vertical, 12)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(receipts) { receipt in
                        Button {
                            selectedReceipt = receipt
                        } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(alignment: .top) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(receipt.summary)
                                            .font(.headline)
                                            .multilineTextAlignment(.leading)
                                        Text(receipt.component.capitalized)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    StatusBadge(state: receipt.status)
                                }

                                Text(receipt.details)
                                    .font(.callout)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(3)
                                    .multilineTextAlignment(.leading)

                                HStack(spacing: 12) {
                                    Text(DateFormatting.formatRelativeTime(receipt.createdAt))
                                    Text(receipt.kind.replacingOccurrences(of: "_", with: " ").capitalized)
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.background.secondary)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .sheet(item: $selectedReceipt) { receipt in
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        InspectorSection(title: "Summary") {
                            DetailRow(label: "Kind", value: receipt.kind.replacingOccurrences(of: "_", with: " ").capitalized)
                            DetailRow(label: "Component", value: receipt.component.capitalized)
                            DetailRow(label: "Status", value: receipt.status.replacingOccurrences(of: "_", with: " ").capitalized)
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
    }
}
