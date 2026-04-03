import SwiftUI
import PopeyeAPI

struct MedicalAppointmentSheet: View {
    let importId: String
    let onSave: (MedicalAppointmentCreateInput) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var date = Date()
    @State private var provider = ""
    @State private var specialty = ""
    @State private var location = ""
    @State private var redactedSummary = ""

    private var canSave: Bool {
        provider.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Add Appointment")
                .font(.title3.bold())
                .padding(20)

            Form {
                DatePicker("Date", selection: $date)
                TextField("Provider", text: $provider)
                TextField("Specialty (optional)", text: $specialty)
                TextField("Location (optional)", text: $location)
                TextField("Redacted Summary (optional)", text: $redactedSummary, axis: .vertical)
                    .lineLimit(3...5)
            }
            .formStyle(.grouped)

            Divider()

            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Add Appointment") {
                    onSave(MedicalAppointmentCreateInput(
                        importId: importId,
                        date: formatDate(date),
                        provider: provider.trimmingCharacters(in: .whitespacesAndNewlines),
                        specialty: optional(specialty),
                        location: optional(location),
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
        .frame(width: 460, height: 320)
    }

    private func optional(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }
}
