import SwiftUI
import PopeyeAPI

struct MedicalAppointmentsSection: View {
    let appointments: [MedicalAppointmentDTO]

    var body: some View {
        InspectorSection(title: "Appointments") {
            if appointments.isEmpty {
                Text("No appointments for the selected import.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(appointments.prefix(10)) { appointment in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(appointment.provider)
                            .font(.headline)
                        Text(appointment.redactedSummary)
                            .foregroundStyle(.secondary)
                        Text(DateFormatting.formatAbsoluteTime(appointment.date))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}
