import SwiftUI
import PopeyeAPI

struct ActiveRunsPanel: View {
    @Bindable var store: CommandCenterStore

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Active Runs")
                .font(.headline)
                .foregroundStyle(.secondary)

            if store.activeRuns.isEmpty {
                emptyState
            } else {
                runsList
            }
        }
    }

    private var runsList: some View {
        VStack(spacing: 0) {
            ForEach(store.activeRuns) { run in
                Button {
                    selectRun(run)
                } label: {
                    runRow(run)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(rowBackground(for: run))

                if run.id != store.activeRuns.last?.id {
                    Divider().padding(.leading, 8)
                }
            }
        }
        .background(.background)
        .clipShape(.rect(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator, lineWidth: 0.5))
    }

    private func runRow(_ run: RunRecordDTO) -> some View {
        HStack(spacing: 8) {
            StatusBadge(state: run.state)
            Text(store.taskTitle(for: run.taskId))
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer()
            Text(DateFormatting.formatRelativeTime(run.startedAt))
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }

    private func rowBackground(for run: RunRecordDTO) -> some View {
        Group {
            if case .run(run.id) = store.selectedItem {
                Color.accentColor.opacity(0.1)
            } else {
                Color.clear
            }
        }
    }

    private var emptyState: some View {
        Text("No active runs")
            .foregroundStyle(.tertiary)
            .font(.callout)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 20)
    }

    private func selectRun(_ run: RunRecordDTO) {
        store.selectedItem = .run(run.id)
    }
}
