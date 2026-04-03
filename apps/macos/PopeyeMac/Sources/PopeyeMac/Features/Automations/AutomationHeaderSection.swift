import SwiftUI
import PopeyeAPI

struct AutomationHeaderSection: View {
    let detail: AutomationDetailDTO
    let runNow: () -> Void
    let pause: () -> Void
    let resume: () -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 16) {
                titleBlock
                Spacer(minLength: 16)
                actionButtons
            }

            VStack(alignment: .leading, spacing: 12) {
                titleBlock
                actionButtons
            }
        }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(detail.title)
                .font(.title2.bold())
            HStack(spacing: 8) {
                StatusBadge(state: detail.status)
                Text(detail.scheduleSummary)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var actionButtons: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                buttons
            }

            VStack(alignment: .leading, spacing: 8) {
                buttons
            }
        }
    }

    private var buttons: some View {
        Group {
            if detail.controls.runNow {
                Button("Run Now", systemImage: "play.fill", action: runNow)
                    .buttonStyle(.borderedProminent)
                    .help("Queue this automation immediately")
            }
            if detail.controls.pause {
                Button("Pause", systemImage: "pause.fill", action: pause)
                    .buttonStyle(.bordered)
                    .help("Pause this automation")
            }
            if detail.controls.resume {
                Button("Resume", systemImage: "playpause.fill", action: resume)
                    .buttonStyle(.bordered)
                    .help("Resume this automation")
            }
        }
    }
}
