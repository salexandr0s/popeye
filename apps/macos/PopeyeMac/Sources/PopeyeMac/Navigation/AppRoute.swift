import Foundation

enum AppRoute: String, CaseIterable, Identifiable, Hashable {
    case dashboard
    case commandCenter
    case usage
    case runs
    case jobs
    case receipts
    case interventions
    case approvals
    case connections
    case usageSecurity
    case memory
    case instructionPreview
    case agentProfiles

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: "Dashboard"
        case .commandCenter: "Command Center"
        case .usage: "Usage"
        case .runs: "Runs"
        case .jobs: "Jobs"
        case .receipts: "Receipts"
        case .interventions: "Interventions"
        case .approvals: "Approvals"
        case .connections: "Connections"
        case .usageSecurity: "Usage & Security"
        case .memory: "Memory"
        case .instructionPreview: "Instructions"
        case .agentProfiles: "Agent Profiles"
        }
    }

    var systemImage: String {
        switch self {
        case .dashboard: "gauge.with.dots.needle.33percent"
        case .commandCenter: "command.square.fill"
        case .usage: "dollarsign.circle"
        case .runs: "play.circle"
        case .jobs: "tray.2"
        case .receipts: "doc.text"
        case .interventions: "exclamationmark.bubble"
        case .approvals: "checkmark.shield"
        case .connections: "link"
        case .usageSecurity: "chart.bar.xaxis"
        case .memory: "brain"
        case .instructionPreview: "doc.plaintext"
        case .agentProfiles: "person.2"
        }
    }

    var group: RouteGroup {
        switch self {
        case .dashboard, .commandCenter, .usage: .overview
        case .runs, .jobs, .receipts: .operations
        case .interventions, .approvals, .usageSecurity: .governance
        case .memory, .instructionPreview: .knowledge
        case .connections, .agentProfiles: .platform
        }
    }
}

enum RouteGroup: String, CaseIterable, Identifiable {
    case overview
    case operations
    case governance
    case knowledge
    case platform

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: "Overview"
        case .operations: "Operations"
        case .governance: "Governance"
        case .knowledge: "Knowledge"
        case .platform: "Platform"
        }
    }

    var routes: [AppRoute] {
        AppRoute.allCases.filter { $0.group == self }
    }
}
