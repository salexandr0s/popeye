import SwiftUI
import PopeyeAPI

struct AutomationSidebarView: View {
    @Binding var selectedAutomationID: String?
    @Binding var filter: AutomationStore.Filter
    @Binding var searchText: String
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

                TextField("Search automations", text: $searchText)
                    .textFieldStyle(.roundedBorder)
            }
            .padding(16)

            Divider()

            List(automations, selection: $selectedAutomationID) { automation in
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
                        Label(automation.source == "heartbeat" ? "Heartbeat" : "Scheduled", systemImage: automation.source == "heartbeat" ? "bolt.circle" : "calendar.badge.clock")
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
                .tag(automation.id)
            }
            .listStyle(.sidebar)
        }
    }
}
