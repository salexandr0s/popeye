import SwiftUI
import PopeyeAPI

struct InstructionPreviewMetadataSection: View {
    let preview: InstructionPreviewDTO

    private var columns: [GridItem] {
        PopeyeUI.cardColumns(minimum: 140, maximum: 220)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: PopeyeUI.cardSpacing) {
            DashboardCard(
                label: "Bundle",
                value: IdentifierFormatting.formatShortID(preview.bundleHash),
                description: DateFormatting.formatAbsoluteTime(preview.createdAt)
            )
            DashboardCard(
                label: "Sources",
                value: "\(preview.sources.count)",
                description: "Included by precedence"
            )
        }
    }
}
