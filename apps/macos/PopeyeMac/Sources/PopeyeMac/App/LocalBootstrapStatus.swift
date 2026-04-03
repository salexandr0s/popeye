import Foundation

struct LocalBootstrapStatus: Decodable, Sendable {
    let configPath: String
    let baseURL: String
    let configExists: Bool
    let configValid: Bool
    let daemonInstalled: Bool
    let daemonLoaded: Bool
    let daemonReachable: Bool
    let authStoreReady: Bool
    let nativeAppSessionsSupported: Bool
    let needsLocalSetup: Bool
    let needsDaemonStart: Bool
    let canGrantNativeSession: Bool
    let error: String?
}
