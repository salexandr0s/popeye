import SwiftUI
import PopeyeAPI

struct MemoryPromotionSheet: View {
    let proposal: MemoryPromotionProposalDTO
    @Bindable var store: MemoryStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Promote Memory")
                .font(.title2.bold())

            DetailRow(label: "Target", value: proposal.targetPath)

            Text("Diff")
                .font(.headline)

            ScrollView {
                Text(proposal.diff)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(.background.secondary)
                    .clipShape(.rect(cornerRadius: 8))
            }
            .frame(maxHeight: 300)

            HStack {
                Spacer()
                Button("Cancel") {
                    store.showPromotionSheet = false
                    store.promotionProposal = nil
                }
                .keyboardShortcut(.cancelAction)

                Button("Promote") {
                    Task { await store.executePromotion() }
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 600, height: 450)
    }
}
