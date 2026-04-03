import SwiftUI
import PopeyeAPI

struct CommandCenterInspector: View {
    let store: CommandCenterStore

    @State private var pendingMutation: PendingMutation?
    @State private var textFieldValue = ""

    enum PendingMutation: Identifiable {
        case retryRun(String)
        case cancelRun(String)
        case pauseJob(String)
        case resumeJob(String)
        case enqueueJob(String)
        case resolveIntervention(String)

        var id: String {
            switch self {
            case .retryRun(let id): "retry-\(id)"
            case .cancelRun(let id): "cancel-\(id)"
            case .pauseJob(let id): "pause-\(id)"
            case .resumeJob(let id): "resume-\(id)"
            case .enqueueJob(let id): "enqueue-\(id)"
            case .resolveIntervention(let id): "resolve-\(id)"
            }
        }
    }

    var body: some View {
        Group {
            switch store.selectedItem {
            case .none:
                emptyInspector
            case .run(let id):
                if let run = store.runs.first(where: { $0.id == id }) {
                    CCRunInspectorSection(
                        run: run,
                        taskTitle: store.taskTitle(for: run.taskId),
                        store: store,
                        pendingMutation: $pendingMutation
                    )
                } else {
                    notFound
                }
            case .job(let id):
                if let job = store.jobs.first(where: { $0.id == id }) {
                    CCJobInspectorSection(
                        job: job,
                        taskTitle: store.taskTitle(for: job.taskId),
                        store: store,
                        pendingMutation: $pendingMutation
                    )
                } else {
                    notFound
                }
            case .intervention(let id):
                if let intv = store.interventions.first(where: { $0.id == id }) {
                    CCInterventionInspectorSection(
                        intervention: intv,
                        store: store,
                        pendingMutation: $pendingMutation
                    )
                } else {
                    notFound
                }
            }
        }
        .frame(minWidth: 260)
        .sheet(item: $pendingMutation) { mutation in
            CCConfirmationSheet(
                mutation: mutation,
                pendingMutation: $pendingMutation,
                textFieldValue: $textFieldValue,
                store: store
            )
        }
    }

    private var emptyInspector: some View {
        VStack(spacing: 8) {
            Image(systemName: "sidebar.right")
                .font(.system(size: 32))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
            Text("Select an item to inspect")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var notFound: some View {
        Text("Item not found")
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .combine)
    }
}
