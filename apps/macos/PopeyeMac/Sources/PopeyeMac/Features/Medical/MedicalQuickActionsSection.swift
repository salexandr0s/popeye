import SwiftUI

struct MedicalQuickActionsSection: View {
    let isMutating: Bool
    let hasVaults: Bool
    let hasActiveImport: Bool
    let regenerateDigest: () -> Void
    let createImport: () -> Void
    let addAppointment: () -> Void
    let addMedication: () -> Void
    let addDocument: () -> Void

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
            .help("Rebuild the medical digest from the latest imported records.")
            .disabled(isMutating)

        Button("Create Import", action: createImport)
            .buttonStyle(.bordered)
            .help("Create a new medical import in the selected vault.")
            .disabled(hasVaults == false)

        Button("Add Appointment", action: addAppointment)
            .buttonStyle(.bordered)
            .help("Add an appointment to the selected medical import.")
            .disabled(hasActiveImport == false)

        Button("Add Medication", action: addMedication)
            .buttonStyle(.bordered)
            .help("Add a medication entry to the selected medical import.")
            .disabled(hasActiveImport == false)

        Button("Add Document", action: addDocument)
            .buttonStyle(.bordered)
            .help("Attach a document to the selected medical import.")
            .disabled(hasActiveImport == false)
    }
}
