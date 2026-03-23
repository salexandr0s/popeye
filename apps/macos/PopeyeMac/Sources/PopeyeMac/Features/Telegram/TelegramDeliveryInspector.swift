import SwiftUI
import PopeyeAPI

struct TelegramDeliveryInspector: View {
    @Environment(AppModel.self) private var appModel
    let delivery: TelegramDeliveryDTO
    let store: TelegramStore

    @State private var pendingAction: Action?
    @State private var operatorNote = ""
    @State private var sentMessageId = ""

    enum Action: String, Identifiable {
        case confirmSent
        case resend
        case abandon

        var id: String { rawValue }

        var apiAction: String {
            switch self {
            case .confirmSent: "confirm_sent"
            case .resend: "resend"
            case .abandon: "abandon"
            }
        }

        var confirmLabel: String {
            switch self {
            case .confirmSent: "Confirm Sent"
            case .resend: "Resend"
            case .abandon: "Abandon"
            }
        }

        var confirmationMessage: String {
            switch self {
            case .confirmSent:
                "Confirm this delivery was sent successfully. You can optionally provide the Telegram message ID."
            case .resend:
                "Queue this delivery for resending. You can optionally add a note."
            case .abandon:
                "Abandon this delivery permanently. This cannot be undone."
            }
        }

        var isDestructive: Bool {
            self == .abandon
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                mutationToast
                TelegramActionsSection(status: delivery.status, store: store, pendingAction: $pendingAction)
                headerSection
                relatedSection
                if store.isLoadingDetail {
                    ProgressView("Loading detail...")
                        .frame(maxWidth: .infinity, alignment: .center)
                } else if let detail = store.selectedDetail {
                    TelegramSendAttemptsSection(attempts: detail.attempts)
                    TelegramResolutionsSection(resolutions: detail.resolutions)
                }
            }
            .padding()
        }
        .sheet(item: $pendingAction) { action in
            TelegramConfirmationSheet(
                deliveryId: delivery.id,
                action: action,
                pendingAction: $pendingAction,
                operatorNote: $operatorNote,
                sentMessageId: $sentMessageId,
                store: store
            )
        }
    }

    @ViewBuilder
    private var mutationToast: some View {
        switch store.mutationState {
        case .succeeded(let msg):
            MutationToast(message: msg, isError: false, onDismiss: { store.dismissMutation() })
        case .failed(let msg):
            MutationToast(message: msg, isError: true, onDismiss: { store.dismissMutation() })
        default:
            EmptyView()
        }
    }

    // MARK: - Sections

    private var headerSection: some View {
        InspectorSection(title: "Delivery") {
            CopyableRow(label: "ID", value: delivery.id)
            DetailRow(label: "Status", value: delivery.status)
            DetailRow(label: "Created", value: DateFormatting.formatAbsoluteTime(delivery.createdAt))
            DetailRow(label: "Updated", value: DateFormatting.formatAbsoluteTime(delivery.updatedAt))
        }
    }

    private var relatedSection: some View {
        InspectorSection(title: "Related") {
            DetailRow(label: "Workspace", value: IdentifierFormatting.formatShortID(delivery.workspaceId))
            DetailRow(label: "Chat ID", value: delivery.chatId)
            DetailRow(label: "Telegram Msg", value: String(delivery.telegramMessageId))
            if let sentId = delivery.sentTelegramMessageId {
                DetailRow(label: "Sent Msg ID", value: String(sentId))
            }
            CopyableRow(label: "Ingress ID", value: delivery.messageIngressId)
            if let runId = delivery.runId {
                NavigableIDRow(label: "Run", id: runId) {
                    appModel.navigateToRun(id: runId)
                }
            }
            if let taskId = delivery.taskId {
                CopyableRow(label: "Task ID", value: taskId)
            }
            if let jobId = delivery.jobId {
                CopyableRow(label: "Job ID", value: jobId)
            }
        }
    }
}
