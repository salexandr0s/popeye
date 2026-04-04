import SwiftUI
import PopeyeAPI

struct PeopleView: View {
    @Bindable var store: PeopleStore

    var body: some View {
        Group {
            if store.isLoading && store.people.isEmpty {
                LoadingStateView(title: "Loading people…")
            } else if let error = store.error, store.people.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                HSplitView {
                    PeopleSidebar(store: store)
                        .popeyeSplitPane(minWidth: 280, idealWidth: 320, maxWidth: 360)
                    PeopleDetailPane(store: store)
                        .popeyeSplitPane(minWidth: 560)
                }
            }
        }
        .navigationTitle("People")
        .searchable(text: $store.searchText, placement: .toolbar, prompt: "Search people…")
        .task {
            await store.load()
        }
        .onChange(of: store.selectedPersonID) { _, newValue in
            guard let newValue else { return }
            Task { await store.loadPerson(id: newValue) }
        }
        .onChange(of: store.searchText) { _, _ in
            store.ensureSelection()
        }
        .popeyeRefreshable(invalidationSignals: [.general, .connections]) {
            await store.load()
        }
    }

    private func reload() {
        Task { await store.load() }
    }
}
