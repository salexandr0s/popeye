import SwiftUI
import PopeyeAPI

struct FinanceTransactionSheet: View {
    let importId: String
    let onSave: (FinanceTransactionCreateInput) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var date = Date()
    @State private var description = ""
    @State private var amount = ""
    @State private var currency = "USD"
    @State private var category = ""
    @State private var merchantName = ""
    @State private var accountLabel = ""
    @State private var redactedSummary = ""

    private var parsedAmount: Double? {
        Double(amount.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private var canSave: Bool {
        description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false && parsedAmount != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Add Transaction")
                .font(.title3.bold())
                .padding(20)

            Form {
                LabeledContent("Import") {
                    Text(importId)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }

                DatePicker("Date", selection: $date, displayedComponents: [.date])
                TextField("Description", text: $description)
                TextField("Amount", text: $amount)
                TextField("Currency", text: $currency)
                    .frame(maxWidth: 120)
                TextField("Category (optional)", text: $category)
                TextField("Merchant (optional)", text: $merchantName)
                TextField("Account Label (optional)", text: $accountLabel)
                TextField("Redacted Summary (optional)", text: $redactedSummary, axis: .vertical)
                    .lineLimit(3...5)
            }
            .formStyle(.grouped)

            Divider()

            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Add Transaction") {
                    guard let parsedAmount else { return }
                    onSave(FinanceTransactionCreateInput(
                        importId: importId,
                        date: formatDate(date),
                        description: description.trimmingCharacters(in: .whitespacesAndNewlines),
                        amount: parsedAmount,
                        currency: currency.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
                        category: optional(category),
                        merchantName: optional(merchantName),
                        accountLabel: optional(accountLabel),
                        redactedSummary: redactedSummary.trimmingCharacters(in: .whitespacesAndNewlines)
                    ))
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(canSave == false)
            }
            .padding(20)
        }
        .frame(width: 520, height: 430)
    }

    private func optional(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .iso8601)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
