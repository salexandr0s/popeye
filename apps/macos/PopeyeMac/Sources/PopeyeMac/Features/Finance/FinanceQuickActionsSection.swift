import SwiftUI

struct FinanceQuickActionsSection: View {
    let isMutating: Bool
    let hasVaults: Bool
    let hasActiveImport: Bool
    let regenerateDigest: () -> Void
    let createImport: () -> Void
    let addTransaction: () -> Void

    var body: some View {
        InspectorSection(title: "Quick Actions") {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    actionButtons
                }

                VStack(alignment: .leading, spacing: 8) {
                    actionButtons
                }
            }
        }
    }

    @ViewBuilder
    private var actionButtons: some View {
        Button("Regenerate Digest", action: regenerateDigest)
            .buttonStyle(.borderedProminent)
            .help("Rebuild the finance digest from the latest imported data.")
            .disabled(isMutating)

        Button("Create Import", action: createImport)
            .buttonStyle(.bordered)
            .help("Create a new finance import in the selected vault.")
            .disabled(hasVaults == false)

        Button("Add Transaction", action: addTransaction)
            .buttonStyle(.bordered)
            .help("Manually add a transaction to the selected finance import.")
            .disabled(hasActiveImport == false)
    }
}
