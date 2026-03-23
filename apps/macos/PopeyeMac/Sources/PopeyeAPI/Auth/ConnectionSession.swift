import Foundation

public enum ConnectionState: Sendable {
    case disconnected
    case connecting
    case connected
    case failed(APIError)
}
