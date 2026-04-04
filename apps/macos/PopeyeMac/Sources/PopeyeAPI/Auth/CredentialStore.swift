import Foundation

public struct CredentialStore: Sendable {
    private let service: String

    public init(service: String = KeychainStore.defaultService) {
        self.service = service
    }

    public func saveToken(_ token: String) throws {
        try saveBearerToken(token)
    }

    public func retrieveToken() throws -> String? {
        try retrieveBearerToken()
    }

    public func deleteToken() throws {
        try deleteBearerToken()
    }

    public func saveBearerToken(_ token: String) throws {
        try keychain(for: .bearerToken).save(token)
    }

    public func retrieveBearerToken() throws -> String? {
        try keychain(for: .bearerToken).retrieve()
    }

    public func deleteBearerToken() throws {
        try keychain(for: .bearerToken).delete()
    }

    public func saveNativeSession(_ sessionToken: String) throws {
        try keychain(for: .nativeSession).save(sessionToken)
    }

    public func retrieveNativeSession() throws -> String? {
        try keychain(for: .nativeSession).retrieve()
    }

    public func deleteNativeSession() throws {
        try keychain(for: .nativeSession).delete()
    }

    public func deleteAllCredentials() throws {
        try deleteBearerToken()
        try deleteNativeSession()
    }

    private func keychain(for kind: StoredCredentialKind) -> KeychainStore {
        KeychainStore(account: kind.keychainAccount, service: service)
    }
}
