import Foundation

enum AppRoute: String, CaseIterable, Identifiable, Hashable {
    case home
    case dashboard
    case commandCenter
    case setup
    case connections
    case telegram
    case brain
    case memory
    case instructionPreview
    case agentProfiles
    case automations
    case email
    case calendar
    case todos
    case people
    case files
    case finance
    case medical
    case scheduler
    case usage
    case runs
    case jobs
    case receipts
    case interventions
    case approvals
    case usageSecurity

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: "Home"
        case .dashboard: "Dashboard"
        case .commandCenter: "Command Center"
        case .setup: "Setup"
        case .connections: "Connections"
        case .telegram: "Telegram"
        case .brain: "Brain"
        case .memory: "Memory"
        case .instructionPreview: "Instructions"
        case .agentProfiles: "Agent Profiles"
        case .automations: "Automations"
        case .email: "Mail"
        case .calendar: "Calendar"
        case .todos: "Todos"
        case .people: "People"
        case .files: "Files"
        case .finance: "Finance"
        case .medical: "Medical"
        case .scheduler: "Scheduler"
        case .usage: "Usage"
        case .runs: "Runs"
        case .jobs: "Jobs"
        case .receipts: "Receipts"
        case .interventions: "Interventions"
        case .approvals: "Approvals"
        case .usageSecurity: "Usage & Security"
        }
    }

    var systemImage: String {
        switch self {
        case .home: "house"
        case .dashboard: "gauge.with.dots.needle.33percent"
        case .commandCenter: "command.square.fill"
        case .setup: "checklist"
        case .connections: "link"
        case .telegram: "paperplane"
        case .brain: "brain.head.profile"
        case .memory: "brain"
        case .instructionPreview: "doc.plaintext"
        case .agentProfiles: "person.2"
        case .automations: "bolt.badge.clock"
        case .email: "envelope"
        case .calendar: "calendar"
        case .todos: "checklist"
        case .people: "person.crop.circle.badge.2"
        case .files: "folder"
        case .finance: "creditcard"
        case .medical: "cross.case"
        case .scheduler: "clock.arrow.2.circlepath"
        case .usage: "dollarsign.circle"
        case .runs: "play.circle"
        case .jobs: "tray.2"
        case .receipts: "doc.text"
        case .interventions: "exclamationmark.bubble"
        case .approvals: "checkmark.shield"
        case .usageSecurity: "chart.bar.xaxis"
        }
    }

    var group: RouteGroup {
        switch self {
        case .home, .dashboard, .commandCenter: .overview
        case .setup, .connections, .telegram: .setup
        case .brain, .memory, .instructionPreview, .agentProfiles: .brain
        case .automations: .automations
        case .email, .calendar, .todos, .people, .files: .life
        case .finance, .medical: .privateDomains
        case .scheduler, .usage, .runs, .jobs, .receipts, .interventions, .approvals, .usageSecurity: .system
        }
    }
}

enum RouteGroup: String, CaseIterable, Identifiable {
    case overview
    case setup
    case brain
    case automations
    case life
    case privateDomains
    case system

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: "Overview"
        case .setup: "Setup"
        case .brain: "Brain"
        case .automations: "Automations"
        case .life: "Life"
        case .privateDomains: "Private"
        case .system: "System"
        }
    }

    var routes: [AppRoute] {
        AppRoute.allCases.filter { $0.group == self }
    }
}
