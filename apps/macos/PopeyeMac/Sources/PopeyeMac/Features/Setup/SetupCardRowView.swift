import SwiftUI

struct SetupCardRowView: View {
    let card: SetupCard

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 10) {
                Label(card.id.title, systemImage: card.id.systemImage)
                    .font(.headline)
                Spacer()
                StatusBadge(state: card.state.rawValue)
            }

            Text(card.summary)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .padding(.vertical, 6)
    }
}
