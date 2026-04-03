import SwiftUI
import PopeyeAPI

struct AutomationDetailView: View {
    let detail: AutomationDetailDTO
    let mutationReceipt: MutationReceiptDTO?
    let viewMode: AutomationStore.ViewMode
    let update: (Bool?, Int?) -> Void
    let runNow: () -> Void
    let pause: () -> Void
    let resume: () -> Void
    let openRun: (String) -> Void

    @State private var enabled: Bool
    @State private var cadenceText: String

    init(
        detail: AutomationDetailDTO,
        mutationReceipt: MutationReceiptDTO?,
        viewMode: AutomationStore.ViewMode,
        update: @escaping (Bool?, Int?) -> Void,
        runNow: @escaping () -> Void,
        pause: @escaping () -> Void,
        resume: @escaping () -> Void,
        openRun: @escaping (String) -> Void
    ) {
        self.detail = detail
        self.mutationReceipt = mutationReceipt
        self.viewMode = viewMode
        self.update = update
        self.runNow = runNow
        self.pause = pause
        self.resume = resume
        self.openRun = openRun
        _enabled = State(initialValue: detail.enabled)
        _cadenceText = State(initialValue: detail.intervalSeconds.map(String.init) ?? "")
    }

    private var parsedCadence: Int? {
        Int(cadenceText.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private var hasPendingChanges: Bool {
        let cadenceChanged = detail.controls.cadenceEdit && parsedCadence != detail.intervalSeconds
        let enabledChanged = detail.controls.enabledEdit && enabled != detail.enabled
        return cadenceChanged || enabledChanged
    }

    private var cadenceValidationMessage: String? {
        guard detail.controls.cadenceEdit else { return nil }
        let trimmed = cadenceText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return "Cadence in seconds is required for this automation." }
        guard let value = Int(trimmed), value > 0 else { return "Cadence must be a positive integer." }
        return nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                AutomationHeaderSection(
                    detail: detail,
                    runNow: runNow,
                    pause: pause,
                    resume: resume
                )
                AutomationSummarySection(detail: detail)
                AutomationControlsSection(
                    detail: detail,
                    enabled: $enabled,
                    cadenceText: $cadenceText,
                    cadenceValidationMessage: cadenceValidationMessage,
                    hasPendingChanges: hasPendingChanges,
                    saveChanges: saveChanges
                )
                AutomationScheduleSection(detail: detail)
                AutomationAttentionSection(reason: detail.attentionReason ?? detail.blockedReason)
                if let mutationReceipt {
                    AutomationMutationReceiptSection(receipt: mutationReceipt)
                }
                if viewMode == .list {
                    AutomationRecentRunsSection(runs: detail.recentRuns, openRun: openRun)
                }
            }
            .padding(PopeyeUI.contentPadding)
        }
    }

    private func saveChanges() {
        update(
            detail.controls.enabledEdit && enabled != detail.enabled ? enabled : nil,
            detail.controls.cadenceEdit && parsedCadence != detail.intervalSeconds ? parsedCadence : nil
        )
    }
}
