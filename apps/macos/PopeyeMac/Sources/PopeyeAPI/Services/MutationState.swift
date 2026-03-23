public enum MutationState: Equatable, Sendable {
    case idle
    case executing
    case succeeded(String)
    case failed(String)
}
