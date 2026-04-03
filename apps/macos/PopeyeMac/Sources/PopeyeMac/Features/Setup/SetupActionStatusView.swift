import SwiftUI

struct SetupActionStatusView: View {
    let statusMessage: String?
    let errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let statusMessage, statusMessage.isEmpty == false {
                HStack(spacing: 10) {
                    ProgressView()
                        .controlSize(.small)

                    Text(statusMessage)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }

            if let errorMessage, errorMessage.isEmpty == false {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout)
                    .foregroundStyle(.orange)
            }
        }
    }
}
