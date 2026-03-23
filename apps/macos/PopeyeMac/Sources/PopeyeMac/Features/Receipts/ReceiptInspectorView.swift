import SwiftUI
import PopeyeAPI

struct ReceiptInspectorView: View {
    let receipt: ReceiptRecordDTO
    @Environment(AppModel.self) private var appModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                headerSection
                summarySection
                UsageBreakdownSection(usage: receipt.usage)
                if let runtime = receipt.runtime {
                    ReceiptRuntimeSection(runtime: runtime)
                }
                if let timeline = receipt.runtime?.timeline, !timeline.isEmpty {
                    ReceiptTimelineSection(events: timeline)
                }
            }
            .padding()
        }
    }

    private var headerSection: some View {
        InspectorSection(title: "Receipt Details") {
            DetailRow(label: "Receipt ID", value: receipt.id)
            DetailRow(label: "Status", value: receipt.status)
            NavigableIDRow(label: "Run ID", id: receipt.runId) {
                appModel.navigateToRun(id: receipt.runId)
            }
            DetailRow(label: "Job ID", value: IdentifierFormatting.formatShortID(receipt.jobId))
            DetailRow(label: "Task ID", value: IdentifierFormatting.formatShortID(receipt.taskId))
            DetailRow(label: "Workspace", value: IdentifierFormatting.formatShortID(receipt.workspaceId))
            DetailRow(label: "Created", value: DateFormatting.formatAbsoluteTime(receipt.createdAt))
        }
    }

    private var summarySection: some View {
        InspectorSection(title: "Summary") {
            Text(receipt.summary)
                .font(.callout)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            if !receipt.details.isEmpty {
                Text(receipt.details)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

}
