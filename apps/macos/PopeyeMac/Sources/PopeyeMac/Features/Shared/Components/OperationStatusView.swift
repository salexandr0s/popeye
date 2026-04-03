import SwiftUI
import PopeyeAPI

struct OperationStatusView: View {
    let phase: ScreenOperationPhase
    let loadingTitle: String
    let failureTitle: String
    let retryAction: (() -> Void)?
    let retryLabel: String

    init(
        phase: ScreenOperationPhase,
        loadingTitle: String,
        failureTitle: String,
        retryAction: (() -> Void)? = nil,
        retryLabel: String = "Retry"
    ) {
        self.phase = phase
        self.loadingTitle = loadingTitle
        self.failureTitle = failureTitle
        self.retryAction = retryAction
        self.retryLabel = retryLabel
    }

    var body: some View {
        switch phase {
        case .idle:
            EmptyView()
        case .loading:
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text(loadingTitle)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        case .failed(let error):
            VStack(alignment: .leading, spacing: 8) {
                Label(failureTitle, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.orange)
                Text(error.userMessage)
                    .font(.callout)
                    .foregroundStyle(.secondary)

                if let retryAction {
                    Button(retryLabel, action: retryAction)
                        .buttonStyle(.bordered)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.orange.opacity(0.08))
            .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))
            .overlay {
                RoundedRectangle(cornerRadius: PopeyeUI.cardCornerRadius)
                    .strokeBorder(.orange.opacity(0.25), lineWidth: 0.5)
            }
        }
    }
}
