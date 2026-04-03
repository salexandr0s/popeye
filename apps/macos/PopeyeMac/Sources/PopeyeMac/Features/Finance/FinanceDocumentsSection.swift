import SwiftUI
import PopeyeAPI

struct FinanceDocumentsSection: View {
    let documents: [FinanceDocumentDTO]

    var body: some View {
        InspectorSection(title: "Documents") {
            if documents.isEmpty {
                Text("No supporting documents for the selected import.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(documents.prefix(8)) { document in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(document.fileName)
                            .font(.headline)
                        Text(document.redactedSummary)
                            .foregroundStyle(.secondary)
                        Text(ByteCountFormatter.string(fromByteCount: Int64(document.sizeBytes), countStyle: .file))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}
