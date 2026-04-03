import SwiftUI
import PopeyeAPI

@MainActor
private struct CommandCenterPreviewContainer: View {
    let store: CommandCenterStore

    var body: some View {
        NavigationStack {
            CommandCenterView(store: store)
        }
        .frame(width: 1280, height: 820)
    }
}

extension CommandCenterStore {
    @MainActor
    static func previewLoading() -> CommandCenterStore {
        let store = CommandCenterStore(dependencies: .init(
            loadRuns: { try await FeaturePreviewFixtures.suspended() },
            loadJobs: { try await FeaturePreviewFixtures.suspended() },
            loadTasks: { try await FeaturePreviewFixtures.suspended() },
            loadInterventions: { try await FeaturePreviewFixtures.suspended() },
            loadDashboardSnapshot: { try await FeaturePreviewFixtures.suspended() },
            retryRun: { _ in try await FeaturePreviewFixtures.suspended() },
            cancelRun: { _ in try await FeaturePreviewFixtures.suspended() },
            pauseJob: { _ in try await FeaturePreviewFixtures.suspended() },
            resumeJob: { _ in try await FeaturePreviewFixtures.suspended() },
            enqueueJob: { _ in try await FeaturePreviewFixtures.suspended() },
            resolveIntervention: { _, _ in try await FeaturePreviewFixtures.suspended() }
        ), pollingEnabled: false)
        store.loadPhase = .loading
        return store
    }

    @MainActor
    static func previewFailed() -> CommandCenterStore {
        let store = CommandCenterStore(dependencies: .init(
            loadRuns: { throw APIError.transportUnavailable },
            loadJobs: { [] },
            loadTasks: { [] },
            loadInterventions: { [] },
            loadDashboardSnapshot: { FeaturePreviewFixtures.dashboardSnapshot },
            retryRun: { _ in },
            cancelRun: { _ in },
            pauseJob: { _ in },
            resumeJob: { _ in },
            enqueueJob: { _ in },
            resolveIntervention: { _, _ in }
        ), pollingEnabled: false)
        store.loadPhase = .failed(.transportUnavailable)
        return store
    }

    @MainActor
    static func previewPopulated() -> CommandCenterStore {
        let store = CommandCenterStore(dependencies: .init(
            loadRuns: { [FeaturePreviewFixtures.commandCenterRun] },
            loadJobs: { [FeaturePreviewFixtures.commandCenterJob] },
            loadTasks: { [FeaturePreviewFixtures.commandCenterTask] },
            loadInterventions: { [FeaturePreviewFixtures.commandCenterIntervention] },
            loadDashboardSnapshot: { FeaturePreviewFixtures.dashboardSnapshot },
            retryRun: { _ in },
            cancelRun: { _ in },
            pauseJob: { _ in },
            resumeJob: { _ in },
            enqueueJob: { _ in },
            resolveIntervention: { _, _ in }
        ), pollingEnabled: false)
        store.runs = [FeaturePreviewFixtures.commandCenterRun]
        store.jobs = [FeaturePreviewFixtures.commandCenterJob]
        store.tasks = [FeaturePreviewFixtures.commandCenterTask]
        store.interventions = [FeaturePreviewFixtures.commandCenterIntervention]
        store.usage = FeaturePreviewFixtures.dashboardSnapshot.usage
        store.scheduler = FeaturePreviewFixtures.dashboardSnapshot.scheduler
        store.lastUpdated = .now
        store.loadPhase = .loaded
        store.selectedItem = .run(FeaturePreviewFixtures.commandCenterRun.id)
        return store
    }

    @MainActor
    static func previewRefreshFailure() -> CommandCenterStore {
        let store = previewPopulated()
        store.refreshPhase = .failed(.transportUnavailable)
        return store
    }

    @MainActor
    static func previewMutationSuccess() -> CommandCenterStore {
        let store = previewPopulated()
        store.mutations.state = .succeeded("Run retry initiated")
        return store
    }

    @MainActor
    static func previewMutationFailure() -> CommandCenterStore {
        let store = previewPopulated()
        store.mutations.state = .failed("Couldn’t retry this run.")
        return store
    }
}

#Preview("Command Center / Loading") {
    CommandCenterPreviewContainer(store: .previewLoading())
}

#Preview("Command Center / Error") {
    CommandCenterPreviewContainer(store: .previewFailed())
}

#Preview("Command Center / Populated") {
    CommandCenterPreviewContainer(store: .previewPopulated())
}

#Preview("Command Center / Refresh Failure") {
    CommandCenterPreviewContainer(store: .previewRefreshFailure())
}

#Preview("Command Center / Mutation Success") {
    CommandCenterPreviewContainer(store: .previewMutationSuccess())
}

#Preview("Command Center / Mutation Failure") {
    CommandCenterPreviewContainer(store: .previewMutationFailure())
}
