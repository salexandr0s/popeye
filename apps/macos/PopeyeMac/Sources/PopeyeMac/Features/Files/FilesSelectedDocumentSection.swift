import SwiftUI
import PopeyeAPI

struct FilesSelectedDocumentSection: View {
    let document: FileDocumentDTO?
    let openMemory: (String) -> Void

    var body: some View {
        InspectorSection(title: "Selected Document") {
            if let document {
                DetailRow(label: "Relative Path", value: document.relativePath)
                DetailRow(label: "Hash", value: document.contentHash)
                DetailRow(
                    label: "Size",
                    value: ByteCountFormatter.string(
                        fromByteCount: Int64(document.sizeBytes),
                        countStyle: .file
                    )
                )
                DetailRow(label: "Updated", value: DateFormatting.formatAbsoluteTime(document.updatedAt))
                if let memoryId = document.memoryId {
                    Button("Open Related Memory") {
                        openMemory(memoryId)
                    }
                    .buttonStyle(.link)
                }
            } else {
                Text("Select a search result to inspect document metadata.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}
