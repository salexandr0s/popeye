import SwiftUI
import PopeyeAPI

struct FinanceTransactionsSection: View {
    let transactions: [FinanceTransactionDTO]

    var body: some View {
        InspectorSection(title: "Transactions") {
            if transactions.isEmpty {
                Text("No transactions for the selected import.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(transactions.prefix(12)) { transaction in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(transaction.description)
                                .font(.headline)
                            Spacer()
                            Text(transaction.amount.formatted(.currency(code: transaction.currency)))
                                .foregroundStyle(transaction.amount >= 0 ? .green : .red)
                        }
                        Text(transaction.redactedSummary)
                            .foregroundStyle(.secondary)
                        Text(transaction.date)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}
