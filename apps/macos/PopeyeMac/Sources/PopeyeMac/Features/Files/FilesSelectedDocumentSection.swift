import SwiftUI
import PopeyeAPI

struct FilesSelectedDocumentSection: View {
    let document: FileDocumentDTO?
    let phase: ScreenOperationPhase
    let reloadDocument: (() -> Void)?
    let openMemory: (String) -> Void

    var body: some View {
        InspectorSection(title: "Selected Document") {
            OperationStatusView(
                phase: phase,
                loadingTitle: "Loading selected document…",
                failureTitle: "Couldn’t load the selected document",
                retryAction: reloadDocument
            )

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
            } else if phase.isLoading == false, phase.error == nil {
                Text("Select a search result to inspect document metadata.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}
