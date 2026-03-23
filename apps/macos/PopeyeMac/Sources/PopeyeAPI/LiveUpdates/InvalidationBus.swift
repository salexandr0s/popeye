import Foundation

public enum InvalidationSignal: Sendable {
    case runs
    case jobs
    case receipts
    case interventions
    case approvals
    case connections
    case security
    case general
}

public actor InvalidationBus {
    private var subscribers: [UUID: AsyncStream<InvalidationSignal>.Continuation] = [:]

    public init() {}

    public func subscribe() -> AsyncStream<InvalidationSignal> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<InvalidationSignal>.makeStream()
        subscribers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeSubscriber(id) }
        }
        return stream
    }

    public func processEvent(_ event: SSEEvent) {
        let signal = mapEventToSignal(event.event)
        for (_, continuation) in subscribers {
            continuation.yield(signal)
        }
    }

    public func stop() {
        for (_, continuation) in subscribers {
            continuation.finish()
        }
        subscribers.removeAll()
    }

    private func removeSubscriber(_ id: UUID) {
        subscribers.removeValue(forKey: id)
    }

    private func mapEventToSignal(_ eventType: String) -> InvalidationSignal {
        let prefix = eventType.prefix(while: { $0 != "." && $0 != "_" })
        switch prefix {
        case "run": return .runs
        case "job": return .jobs
        case "receipt": return .receipts
        case "intervention": return .interventions
        case "approval": return .approvals
        case "connection": return .connections
        case "security", "audit": return .security
        default: return .general
        }
    }
}
