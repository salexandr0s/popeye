import Foundation

enum BrainPane: String, CaseIterable, Identifiable, Hashable {
    case overview
    case identity
    case composition

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: "Overview"
        case .identity: "Identity & Soul"
        case .composition: "Instruction Composition"
        }
    }

    var systemImage: String {
        switch self {
        case .overview: "brain.head.profile"
        case .identity: "person.text.rectangle"
        case .composition: "square.stack.3d.up"
        }
    }
}
