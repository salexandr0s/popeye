import SwiftUI

#Preview("Control Changes / Empty") {
    ControlChangesSection(receipts: [])
        .padding()
        .frame(width: 640, height: 320)
}

#Preview("Control Changes / Populated") {
    ControlChangesSection(receipts: FeaturePreviewFixtures.homeSummary.controlChanges)
        .padding()
        .frame(width: 640, height: 420)
}

#Preview("Control Changes / Detail") {
    ControlChangeDetailSheet(receipt: FeaturePreviewFixtures.homeSummary.controlChanges.first ?? FeaturePreviewFixtures.automationMutationReceipt)
        .frame(width: 640, height: 520)
}
