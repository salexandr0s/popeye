import SwiftUI
import PopeyeAPI

struct FinanceAnomalyFlagsSection: View {
    let digest: FinanceDigestDTO?

    @ViewBuilder
    var body: some View {
        if let digest, digest.anomalyFlags.isEmpty == false {
            InspectorSection(title: "Anomaly Flags") {
                ForEach(digest.anomalyFlags) { flag in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(flag.description)
                                .font(.headline)
                            Spacer()
                            StatusBadge(state: flag.severity)
                        }
                        if let transactionId = flag.transactionId {
                            Text(transactionId)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }
}
