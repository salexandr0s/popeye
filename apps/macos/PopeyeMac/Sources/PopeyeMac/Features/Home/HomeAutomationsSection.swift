import SwiftUI
import PopeyeAPI

struct HomeAutomationsSection: View {
    let automationAttention: [AutomationRecordDTO]
    let automationDueSoon: [AutomationRecordDTO]
    let openAutomations: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Automations")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Open Automations", action: openAutomations)
                    .buttonStyle(.link)
            }

            if automationAttention.isEmpty, automationDueSoon.isEmpty {
                EmptyStateView(
                    icon: "bolt.badge.clock",
                    title: "No automation activity yet",
                    description: "Recurring work will appear here once scheduler-backed tasks are running."
                )
            } else {
                InspectorSection(title: "Needs Attention") {
                    if automationAttention.isEmpty {
                        Text("No automations are currently blocked or waiting for operator action.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(automationAttention) { automation in
                            automationRow(automation)
                        }
                    }
                }

                InspectorSection(title: "Due Soon") {
                    ForEach(automationDueSoon) { automation in
                        automationRow(automation)
                    }
                }
            }
        }
    }

    private func automationRow(_ automation: AutomationRecordDTO) -> some View {
        Button(action: openAutomations) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(automation.title)
                        .font(.headline)
                        .multilineTextAlignment(.leading)
                    Text(automation.attentionReason ?? automation.blockedReason ?? automation.scheduleSummary)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                StatusBadge(state: automation.status)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.background.secondary)
            .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(automation.title)
        .accessibilityValue(accessibilityValue(for: automation))
    }

    private func accessibilityValue(for automation: AutomationRecordDTO) -> String {
        [
            "Status \(automation.status.replacingOccurrences(of: "_", with: " "))",
            automation.attentionReason ?? automation.blockedReason ?? automation.scheduleSummary
        ]
        .compactMap { $0 }
        .joined(separator: ", ")
    }
}
