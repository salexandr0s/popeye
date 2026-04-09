import SwiftUI
import PopeyeAPI

struct EmailThreadDetailSection: View {
    let thread: EmailThreadDTO
    let isLoadingMessages: Bool
    let messageError: APIError?
    let canCompose: Bool
    let reply: () -> Void
    let replyAll: () -> Void
    let forward: () -> Void

    var body: some View {
        InspectorSection(title: thread.subject.isEmpty ? "Thread" : thread.subject) {
            DetailRow(label: "Messages", value: "\(thread.messageCount)")
            DetailRow(label: "Importance", value: thread.importance.capitalized)
            DetailRow(label: "Last updated", value: DateFormatting.formatAbsoluteTime(thread.lastMessageAt))
            Text(thread.snippet)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

            if isLoadingMessages {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Loading thread context…")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            if let messageError {
                Text(messageError.userMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            HStack(spacing: 12) {
                Button("Reply", systemImage: "arrowshape.turn.up.left") {
                    reply()
                }
                .disabled(!canCompose)

                Button("Reply All", systemImage: "arrowshape.turn.up.left.2") {
                    replyAll()
                }
                .disabled(!canCompose)

                Button("Forward", systemImage: "arrowshape.turn.up.right") {
                    forward()
                }
                .disabled(!canCompose)
            }
            .padding(.top, 4)
        }
    }
}
