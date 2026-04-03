import SwiftUI

struct HomeHeaderSection: View {
    let workspaceName: String
    let openSetup: () -> Void
    let openBrain: () -> Void
    let openAutomations: () -> Void
    let openMemory: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(workspaceName)
                .font(.title2.bold())
            Text("Your daily control center for setup health, recurring work, memory, and what needs attention next.")
                .font(.callout)
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                Button("Setup", systemImage: "checklist", action: openSetup)
                    .buttonStyle(.bordered)
                Button("Brain", systemImage: "brain.head.profile", action: openBrain)
                    .buttonStyle(.bordered)
                Button("Automations", systemImage: "bolt.badge.clock", action: openAutomations)
                    .buttonStyle(.borderedProminent)
                Button("Memory", systemImage: "brain", action: openMemory)
                    .buttonStyle(.bordered)
            }
        }
    }
}
