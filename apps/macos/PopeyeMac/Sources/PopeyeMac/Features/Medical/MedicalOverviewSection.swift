import SwiftUI
import PopeyeAPI

struct MedicalOverviewSection: View {
    let digest: MedicalDigestDTO?

    @ViewBuilder
    var body: some View {
        if let digest {
            LazyVGrid(columns: PopeyeUI.cardColumns(minimum: 160, maximum: 240), spacing: PopeyeUI.cardSpacing) {
                DashboardCard(label: "Appointments", value: "\(digest.appointmentCount)", description: digest.period)
                DashboardCard(label: "Medications", value: "\(digest.activeMedications)", description: digest.period)
                DashboardCard(label: "Digest", value: "Current", description: digest.summary, valueColor: .green)
            }
        }
    }
}
