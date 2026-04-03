import SwiftUI
import PopeyeAPI

struct AutomationsContentPane: View {
    @Bindable var store: AutomationStore
    let workspaceName: String
    let selectedDetail: AutomationDetailDTO?
    let update: (Bool?, Int?) -> Void
    let runNow: () -> Void
    let pause: () -> Void
    let resume: () -> Void
    let openRun: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            AutomationsHeader(workspaceName: workspaceName, viewMode: $store.viewMode)
            Divider()
            detailContent
        }
    }

    @ViewBuilder
    private var detailContent: some View {
        if store.viewMode == .week {
            VSplitView {
                AutomationWeekView(
                    automations: store.filteredAutomations,
                    selectedAutomationID: store.selectedAutomationID,
                    onSelect: { store.selectedAutomationID = $0 }
                )
                .frame(minHeight: 260)

                selectedDetailView
            }
        } else {
            selectedDetailView
        }
    }

    @ViewBuilder
    private var selectedDetailView: some View {
        if let selectedDetail {
            AutomationDetailView(
                detail: selectedDetail,
                mutationReceipt: store.selectedMutationReceipt,
                viewMode: store.viewMode,
                update: update,
                runNow: runNow,
                pause: pause,
                resume: resume,
                openRun: openRun
            )
            .id(selectedDetail.id + "-" + String(selectedDetail.enabled) + "-" + String(selectedDetail.intervalSeconds ?? -1))
        } else {
            ContentUnavailableView("Select an automation", systemImage: "bolt.badge.clock")
        }
    }
}
