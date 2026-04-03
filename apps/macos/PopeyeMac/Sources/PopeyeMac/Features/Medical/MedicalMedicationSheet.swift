import SwiftUI
import PopeyeAPI

struct MedicalMedicationSheet: View {
    let importId: String
    let onSave: (MedicalMedicationCreateInput) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var dosage = ""
    @State private var frequency = ""
    @State private var prescriber = ""
    @State private var startDate = Date()
    @State private var endDate = Date()
    @State private var includeEndDate = false
    @State private var redactedSummary = ""

    private var canSave: Bool {
        name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Add Medication")
                .font(.title3.bold())
                .padding(20)

            Form {
                TextField("Medication Name", text: $name)
                TextField("Dosage (optional)", text: $dosage)
                TextField("Frequency (optional)", text: $frequency)
                TextField("Prescriber (optional)", text: $prescriber)
                DatePicker("Start Date", selection: $startDate, displayedComponents: [.date])
                Toggle("Include End Date", isOn: $includeEndDate)
                if includeEndDate {
                    DatePicker("End Date", selection: $endDate, displayedComponents: [.date])
                }
                TextField("Redacted Summary (optional)", text: $redactedSummary, axis: .vertical)
                    .lineLimit(3...5)
            }
            .formStyle(.grouped)

            Divider()

            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Add Medication") {
                    onSave(MedicalMedicationCreateInput(
                        importId: importId,
                        name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                        dosage: optional(dosage),
                        frequency: optional(frequency),
                        prescriber: optional(prescriber),
                        startDate: formatDate(startDate),
                        endDate: includeEndDate ? formatDate(endDate) : nil,
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
        .frame(width: 460, height: 420)
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
