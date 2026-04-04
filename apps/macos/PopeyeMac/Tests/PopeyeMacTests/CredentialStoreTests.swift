import Testing
import Foundation
@testable import PopeyeAPI

@Suite("PopeyeMac")
struct PopeyeMacTests {
    @Test("CredentialStore bearer round-trip")
    func credentialStoreRoundTrip() throws {
        let store = CredentialStore(service: testKeychainService())
        let testToken = "test-token-\(UUID().uuidString)"

        try? store.deleteAllCredentials()

        try store.saveBearerToken(testToken)
        let retrieved = try store.retrieveBearerToken()
        #expect(retrieved == testToken)

        try store.deleteBearerToken()
        let afterDelete = try store.retrieveBearerToken()
        #expect(afterDelete == nil)
    }

    @Test("CredentialStore native session round-trip")
    func nativeSessionRoundTrip() throws {
        let store = CredentialStore(service: testKeychainService())
        let sessionToken = "native-session-\(UUID().uuidString)"

        try? store.deleteAllCredentials()

        try store.saveNativeSession(sessionToken)
        let retrieved = try store.retrieveNativeSession()
        #expect(retrieved == sessionToken)

        try store.deleteNativeSession()
        let afterDelete = try store.retrieveNativeSession()
        #expect(afterDelete == nil)
    }

    @Test("APIError user messages are non-empty")
    func apiErrorMessages() {
        let errors: [APIError] = [
            .transportUnavailable,
            .unauthorized,
            .forbidden,
            .csrfInvalid,
            .notFound,
            .apiFailure(statusCode: 500, message: "test"),
        ]

        for error in errors {
            #expect(error.userMessage.isEmpty == false)
        }
    }

    private func testKeychainService() -> String {
        "com.popeye.mac.tests.\(UUID().uuidString)"
    }
}
