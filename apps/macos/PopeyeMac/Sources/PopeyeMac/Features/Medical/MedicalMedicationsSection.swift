import SwiftUI
import PopeyeAPI

struct MedicalMedicationsSection: View {
    let medications: [MedicalMedicationDTO]

    var body: some View {
        InspectorSection(title: "Medications") {
            if medications.isEmpty {
                Text("No medications for the selected import.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(medications.prefix(10)) { medication in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(medication.name)
                            .font(.headline)
                        Text(medication.redactedSummary)
                            .foregroundStyle(.secondary)
                        Text(medication.frequency ?? medication.dosage ?? "Schedule not recorded")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}
