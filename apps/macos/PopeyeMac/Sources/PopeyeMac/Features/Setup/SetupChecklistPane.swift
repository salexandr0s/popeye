import SwiftUI

struct SetupChecklistPane: View {
    @Binding var selectedCardID: SetupCardID?
    let workspaceName: String
    let cards: [SetupCard]
    let completedCount: Int
    let summary: String

    var body: some View {
        VStack(spacing: 0) {
            SetupChecklistHeader(
                workspaceName: workspaceName,
                completedCount: completedCount,
                totalCount: cards.count,
                summary: summary
            )

            Divider()

            List(cards, selection: $selectedCardID) { card in
                SetupCardRowView(card: card)
                    .tag(card.id)
            }
            .listStyle(.sidebar)
        }
    }
}
