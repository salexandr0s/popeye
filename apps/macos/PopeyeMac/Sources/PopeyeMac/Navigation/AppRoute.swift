import Foundation

enum AppRoute: String, CaseIterable, Identifiable, Hashable {
    case dashboard
    case commandCenter
    case runs
    case jobs
    case receipts
    case interventions
    case approvals
    case connections
    case usageSecurity

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: "Dashboard"
        case .commandCenter: "Command Center"
        case .runs: "Runs"
        case .jobs: "Jobs"
        case .receipts: "Receipts"
        case .interventions: "Interventions"
        case .approvals: "Approvals"
        case .connections: "Connections"
        case .usageSecurity: "Usage & Security"
        }
    }

    var systemImage: String {
        switch self {
        case .dashboard: "gauge.with.dots.needle.33percent"
        case .commandCenter: "command.square.fill"
        case .runs: "play.circle"
        case .jobs: "tray.2"
        case .receipts: "doc.text"
        case .interventions: "exclamationmark.bubble"
        case .approvals: "checkmark.shield"
        case .connections: "link"
        case .usageSecurity: "chart.bar.xaxis"
        }
    }

    var group: RouteGroup {
        switch self {
        case .dashboard, .commandCenter: .overview
        case .runs, .jobs, .receipts: .operations
        case .interventions, .approvals, .usageSecurity: .governance
        case .connections: .integrations
        }
    }
}

enum RouteGroup: String, CaseIterable, Identifiable {
    case overview
    case operations
    case governance
    case integrations

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: "Overview"
        case .operations: "Operations"
        case .governance: "Governance"
        case .integrations: "Integrations"
        }
    }

    var routes: [AppRoute] {
        AppRoute.allCases.filter { $0.group == self }
    }
}
