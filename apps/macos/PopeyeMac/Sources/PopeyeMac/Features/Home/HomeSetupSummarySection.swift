import SwiftUI

struct HomeSetupSummarySection: View {
    let supportedProviderCount: Int
    let healthyProviderCount: Int
    let attentionProviderCount: Int
    let telegramStatusLabel: String
    let telegramEffectiveWorkspaceID: String?

    private var columns: [GridItem] {
        PopeyeUI.cardColumns(minimum: 180, maximum: 260)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Setup Status")
                .font(.headline)
                .foregroundStyle(.secondary)

            LazyVGrid(columns: columns, spacing: PopeyeUI.cardSpacing) {
                DashboardCard(
                    label: "Providers",
                    value: "\(supportedProviderCount)",
                    description: "GitHub, Gmail, Calendar, Telegram"
                )
                DashboardCard(
                    label: "Healthy",
                    value: "\(healthyProviderCount)",
                    description: "Ready for daily use",
                    valueColor: healthyProviderCount == supportedProviderCount ? .green : .primary
                )
                DashboardCard(
                    label: "Attention",
                    value: "\(attentionProviderCount)",
                    description: attentionProviderCount == 0 ? "No blockers visible" : "Reconnect or review setup",
                    valueColor: attentionProviderCount == 0 ? .green : .orange
                )
                DashboardCard(
                    label: "Telegram",
                    value: telegramStatusLabel,
                    description: telegramEffectiveWorkspaceID.map { "Runtime-global → \($0)" } ?? "Runtime-global bridge",
                    valueColor: telegramStatusLabel == "Active" ? .green : .orange
                )
            }
        }
    }
}
