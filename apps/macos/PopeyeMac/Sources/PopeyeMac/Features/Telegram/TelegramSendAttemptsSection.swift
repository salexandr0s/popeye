import SwiftUI
import PopeyeAPI

struct TelegramSendAttemptsSection: View {
    let attempts: [TelegramSendAttemptDTO]

    var body: some View {
        InspectorSection(title: "Send Attempts") {
            if attempts.isEmpty {
                Text("No send attempts recorded.")
                    .font(.callout)
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(attempts) { attempt in
                        attemptRow(attempt)
                    }
                }
            }
        }
    }

    private func attemptRow(_ attempt: TelegramSendAttemptDTO) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text("Attempt #\(attempt.attemptNumber)")
                    .font(.callout.weight(.medium))
                StatusBadge(state: attempt.outcome)
            }
            HStack(spacing: 12) {
                DetailRow(label: "Started", value: DateFormatting.formatRelativeTime(attempt.startedAt))
                if let finished = attempt.finishedAt {
                    DetailRow(label: "Finished", value: DateFormatting.formatRelativeTime(finished))
                }
            }
            if let error = attempt.errorSummary {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(8)
        .background(.background)
        .clipShape(.rect(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(.separator, lineWidth: 0.5)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Attempt \(attempt.attemptNumber)")
        .accessibilityValue(attemptSummary(attempt))
    }

    private func attemptSummary(_ attempt: TelegramSendAttemptDTO) -> String {
        var parts = [
            "Outcome \(attempt.outcome)",
            "Started \(DateFormatting.formatRelativeTime(attempt.startedAt))"
        ]
        if let finished = attempt.finishedAt {
            parts.append("Finished \(DateFormatting.formatRelativeTime(finished))")
        }
        if let error = attempt.errorSummary, !error.isEmpty {
            parts.append("Error \(error)")
        }
        return parts.joined(separator: ", ")
    }
}
