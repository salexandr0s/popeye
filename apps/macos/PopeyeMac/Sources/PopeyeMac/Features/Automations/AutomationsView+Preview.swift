import SwiftUI
import PopeyeAPI

@MainActor
private struct AutomationsPreviewContainer: View {
    let store: AutomationStore
    private let appModel = FeaturePreviewFixtures.previewAppModel()

    var body: some View {
        NavigationStack {
            AutomationsView(store: store)
        }
        .environment(appModel)
        .frame(width: 1180, height: 760)
    }
}

extension AutomationStore {
    @MainActor
    static func previewLoading() -> AutomationStore {
        let store = AutomationStore(dependencies: .init(
            loadAutomations: { _ in try await FeaturePreviewFixtures.suspended() },
            loadAutomation: { _ in try await FeaturePreviewFixtures.suspended() },
            loadMutationReceipts: { _, _ in try await FeaturePreviewFixtures.suspended() },
            updateAutomation: { _, _ in try await FeaturePreviewFixtures.suspended() },
            runAutomationNow: { _ in try await FeaturePreviewFixtures.suspended() },
            pauseAutomation: { _ in try await FeaturePreviewFixtures.suspended() },
            resumeAutomation: { _ in try await FeaturePreviewFixtures.suspended() }
        ))
        store.loadPhase = .loading
        return store
    }

    @MainActor
    static func previewEmpty() -> AutomationStore {
        let store = AutomationStore(dependencies: .init(
            loadAutomations: { _ in [] },
            loadAutomation: { _ in FeaturePreviewFixtures.automationDetail },
            loadMutationReceipts: { _, _ in [] },
            updateAutomation: { _, _ in },
            runAutomationNow: { _ in },
            pauseAutomation: { _ in },
            resumeAutomation: { _ in }
        ))
        store.loadPhase = .empty
        return store
    }

    @MainActor
    static func previewFailed() -> AutomationStore {
        let store = AutomationStore(dependencies: .init(
            loadAutomations: { _ in throw APIError.transportUnavailable },
            loadAutomation: { _ in FeaturePreviewFixtures.automationDetail },
            loadMutationReceipts: { _, _ in [] },
            updateAutomation: { _, _ in },
            runAutomationNow: { _ in },
            pauseAutomation: { _ in },
            resumeAutomation: { _ in }
        ))
        store.loadPhase = .failed(.transportUnavailable)
        return store
    }

    @MainActor
    static func previewPopulated() -> AutomationStore {
        let automation = FeaturePreviewFixtures.automationRecord
        let store = AutomationStore(dependencies: .init(
            loadAutomations: { _ in [automation] },
            loadAutomation: { _ in FeaturePreviewFixtures.automationDetail },
            loadMutationReceipts: { _, _ in [FeaturePreviewFixtures.automationMutationReceipt] },
            updateAutomation: { _, _ in },
            runAutomationNow: { _ in },
            pauseAutomation: { _ in },
            resumeAutomation: { _ in }
        ))
        store.automations = [automation]
        store.selectedAutomationID = automation.id
        store.selectedDetail = FeaturePreviewFixtures.automationDetail
        store.mutationReceipts = [FeaturePreviewFixtures.automationMutationReceipt]
        store.loadPhase = .loaded
        return store
    }

    @MainActor
    static func previewDetailFailure() -> AutomationStore {
        let store = previewPopulated()
        store.selectedDetail = nil
        store.detailPhase = .failed(.transportUnavailable)
        return store
    }

    @MainActor
    static func previewMutationSuccess() -> AutomationStore {
        let store = previewPopulated()
        store.mutations.state = .succeeded("Automation updated")
        return store
    }

    @MainActor
    static func previewMutationFailure() -> AutomationStore {
        let store = previewPopulated()
        store.mutations.state = .failed("Couldn’t update this automation.")
        return store
    }
}

#Preview("Automations / Loading") {
    AutomationsPreviewContainer(store: .previewLoading())
}

#Preview("Automations / Empty") {
    AutomationsPreviewContainer(store: .previewEmpty())
}

#Preview("Automations / Error") {
    AutomationsPreviewContainer(store: .previewFailed())
}

#Preview("Automations / Populated") {
    AutomationsPreviewContainer(store: .previewPopulated())
}

#Preview("Automations / Detail Failure") {
    AutomationsPreviewContainer(store: .previewDetailFailure())
}

#Preview("Automations / Mutation Success") {
    AutomationsPreviewContainer(store: .previewMutationSuccess())
}

#Preview("Automations / Mutation Failure") {
    AutomationsPreviewContainer(store: .previewMutationFailure())
}
