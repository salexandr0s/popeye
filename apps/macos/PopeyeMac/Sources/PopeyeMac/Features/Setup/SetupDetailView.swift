import SwiftUI

struct SetupDetailView: View {
    let card: SetupCard
    let statusMessage: String?
    let errorMessage: String?
    let isPerformingPrimaryAction: Bool
    let runPrimaryAction: (SetupCardAction) -> Void
    let openDestination: (SetupCardDestination) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                SetupCardHeaderSection(card: card)
                SetupActionStatusView(
                    statusMessage: statusMessage,
                    errorMessage: errorMessage
                )
                SetupCardDetailsSection(rows: card.detailRows)
                SetupCardFollowUpSection(
                    rows: card.followUpRows,
                    footnote: card.followUpFootnote
                )
                SetupCardActionsSection(
                    card: card,
                    isPerformingPrimaryAction: isPerformingPrimaryAction,
                    runPrimaryAction: runPrimaryAction,
                    openDestination: openDestination
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PopeyeUI.contentPadding)
        }
    }
}
