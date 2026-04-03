import SwiftUI

struct SetupCardHeaderSection: View {
    let card: SetupCard

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(card.id.title, systemImage: card.id.systemImage)
                .font(.title2.bold())

            StatusBadge(state: card.state.rawValue)

            Text(card.summary)
                .font(.title3)
                .textSelection(.enabled)

            Text(card.guidance)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }
}
