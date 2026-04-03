import SwiftUI
import PopeyeAPI

struct AutomationRecentRunsSection: View {
    let runs: [AutomationRecentRunDTO]
    let openRun: (String) -> Void

    var body: some View {
        InspectorSection(title: "Recent Runs") {
            if runs.isEmpty {
                Text("This automation has not run yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(runs) { run in
                    Button {
                        openRun(run.id)
                    } label: {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(run.id)
                                    .font(.callout.monospaced())
                                Text(run.startedAt)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if run.pendingApprovalCount > 0 {
                                Text("\(run.pendingApprovalCount) approval")
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                            }
                            if run.openInterventionCount > 0 {
                                Text("\(run.openInterventionCount) intervention")
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                            }
                            StatusBadge(state: run.state)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Run \(run.id)")
                    .accessibilityValue(accessibilityValue(for: run))
                }
            }
        }
    }

    private func accessibilityValue(for run: AutomationRecentRunDTO) -> String {
        let approvalSummary = run.pendingApprovalCount > 0 ? "\(run.pendingApprovalCount) pending approval\(run.pendingApprovalCount == 1 ? "" : "s")" : nil
        let interventionSummary = run.openInterventionCount > 0 ? "\(run.openInterventionCount) open intervention\(run.openInterventionCount == 1 ? "" : "s")" : nil

        return [
            "Started \(run.startedAt)",
            approvalSummary,
            interventionSummary,
            "Status \(run.state.replacingOccurrences(of: "_", with: " "))"
        ]
        .compactMap { $0 }
        .joined(separator: ", ")
    }
}
