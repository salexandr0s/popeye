import SwiftUI

struct ImportStatusActionRow: View {
    let selectedStatus: String
    let isDisabled: Bool
    let updateStatus: (String) -> Void

    private let statuses = ["pending", "processing", "completed", "failed"]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                buttons
            }

            VStack(alignment: .leading, spacing: 8) {
                buttons
            }
        }
    }

    @ViewBuilder
    private var buttons: some View {
        ForEach(statuses, id: \.self) { status in
            Button(status.capitalized) {
                updateStatus(status)
            }
            .buttonStyle(.bordered)
            .tint(status == selectedStatus ? .accentColor : .secondary)
            .disabled(isDisabled)
        }
    }
}
