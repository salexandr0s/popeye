import SwiftUI

struct AttentionQueuePanel: View {
    let store: CommandCenterStore

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Attention Queue")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Spacer()
                if !store.attentionItems.isEmpty {
                    Text("\(store.attentionItems.count)")
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(.orange)
                        .clipShape(.capsule)
                }
            }

            if store.attentionItems.isEmpty {
                emptyState
            } else {
                itemsList
            }
        }
    }

    private var itemsList: some View {
        VStack(spacing: 0) {
            ForEach(store.attentionItems) { item in
                attentionRow(item)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)

                if item.id != store.attentionItems.last?.id {
                    Divider().padding(.leading, 8)
                }
            }
        }
        .background(.background)
        .clipShape(.rect(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator, lineWidth: 0.5))
    }

    private func attentionRow(_ item: CommandCenterStore.AttentionItem) -> some View {
        HStack(spacing: 8) {
            Image(systemName: iconName(for: item.kind))
                .foregroundStyle(iconColor(for: item.kind))
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.callout.weight(.medium))
                Text(item.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding(.vertical, 2)
    }

    private var emptyState: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle")
                .foregroundStyle(.green)
            Text("All clear")
                .foregroundStyle(.secondary)
        }
        .font(.callout)
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, 20)
    }

    private func iconName(for kind: CommandCenterStore.AttentionItem.Kind) -> String {
        switch kind {
        case .idle: "moon.zzz"
        case .stuckRisk: "exclamationmark.triangle"
        case .blocked: "hand.raised"
        case .intervention: "exclamationmark.bubble"
        case .failure: "xmark.circle"
        }
    }

    private func iconColor(for kind: CommandCenterStore.AttentionItem.Kind) -> Color {
        switch kind {
        case .idle: .yellow
        case .stuckRisk: .red
        case .blocked: .orange
        case .intervention: .orange
        case .failure: .red
        }
    }
}
