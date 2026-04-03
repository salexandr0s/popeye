import SwiftUI
import PopeyeAPI

struct BrainView: View {
    @Bindable var store: BrainStore
    @Environment(AppModel.self) private var appModel

    var body: some View {
        Group {
            if store.isLoading && store.preview == nil && store.identities.isEmpty {
                LoadingStateView(title: "Loading brain…")
            } else if let error = store.error, store.preview == nil {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                brainContent
            }
        }
        .navigationTitle("Brain")
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await store.load()
        }
        .popeyeRefreshable(invalidationSignals: [.general, .memory]) {
            await store.load()
        }
    }

    private var brainContent: some View {
        HSplitView {
            BrainSidebarView(selection: $store.selectedPane)
                .frame(minWidth: 220, idealWidth: 240, maxWidth: 280)

            ScrollView {
                switch store.selectedPane ?? .overview {
                case .overview:
                    BrainOverviewPane(
                        snapshot: store.snapshot,
                        openMemory: { appModel.navigateToMemory(preferredMode: .daily) },
                        openInstructions: appModel.navigateToInstructions,
                        openAgentProfiles: appModel.navigateToAgentProfiles
                    )
                case .identity:
                    BrainIdentityPane(snapshot: store.snapshot)
                case .composition:
                    BrainCompositionPane(
                        snapshot: store.snapshot,
                        openInstructions: appModel.navigateToInstructions
                    )
                }
            }
            .frame(minWidth: 520)
        }
    }

    private func reload() {
        Task { await store.load() }
    }
}
