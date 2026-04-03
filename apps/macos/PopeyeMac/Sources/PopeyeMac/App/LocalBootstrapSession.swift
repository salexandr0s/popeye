import Foundation

struct LocalBootstrapSession: Decodable, Sendable {
    let baseURL: String
    let sessionToken: String
    let expiresAt: String
}
