import SwiftUI
import PopeyeAPI

struct AutomationSidebarView: View {
    @Binding var selectedAutomationID: String?
    @Binding var filter: AutomationStore.Filter
    let automations: [AutomationRecordDTO]

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                Picker("Filter", selection: $filter) {
                    ForEach(AutomationStore.Filter.allCases, id: \.self) { filter in
                        Text(filter.title).tag(filter)
                    }
                }
                .pickerStyle(.segmented)

                Text("\(automations.count) automation\(automations.count == 1 ? "" : "s")")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            .padding(PopeyeUI.contentPadding)

            Divider()

            if automations.isEmpty {
                EmptyStateView(
                    icon: "bolt.badge.clock",
                    title: "No matching automations",
                    description: "Adjust the current filter or toolbar search to see scheduled and heartbeat automations."
                )
            } else {
                List(automations, selection: $selectedAutomationID) { automation in
                    row(for: automation)
                        .tag(automation.id)
                }
                .listStyle(.sidebar)
            }
        }
    }

    private func row(for automation: AutomationRecordDTO) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(automation.title)
                    .font(.headline)
                    .lineLimit(1)
                Spacer()
                StatusBadge(state: automation.status)
            }
            Text(automation.scheduleSummary)
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            HStack(spacing: 8) {
                Label(
                    automation.source == "heartbeat" ? "Heartbeat" : "Scheduled",
                    systemImage: automation.source == "heartbeat" ? "bolt.circle" : "calendar.badge.clock"
                )
                .font(.caption)
                .foregroundStyle(.secondary)

                if automation.openInterventionCount > 0 || automation.pendingApprovalCount > 0 {
                    Text("\(automation.openInterventionCount + automation.pendingApprovalCount) open")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(automation.title)
        .accessibilityValue(accessibilityValue(for: automation))
    }

    private func accessibilityValue(for automation: AutomationRecordDTO) -> String {
        let openWorkCount = automation.openInterventionCount + automation.pendingApprovalCount
        return [
            "Status \(automation.status.replacingOccurrences(of: "_", with: " "))",
            automation.scheduleSummary,
            automation.source == "heartbeat" ? "Heartbeat automation" : "Scheduled automation",
            openWorkCount > 0 ? "\(openWorkCount) open item\(openWorkCount == 1 ? "" : "s")" : nil
        ]
        .compactMap { $0 }
        .joined(separator: ", ")
    }
}
