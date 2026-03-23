import Testing
import Foundation
@testable import PopeyeAPI

@Suite("PopeyeMac")
struct PopeyeMacTests {
    @Test("CredentialStore round-trip")
    func credentialStoreRoundTrip() throws {
        let store = CredentialStore()
        let testToken = "test-token-\(UUID().uuidString)"

        // Clean up first
        try? store.deleteToken()

        // Save and retrieve
        try store.saveToken(testToken)
        let retrieved = try store.retrieveToken()
        #expect(retrieved == testToken)

        // Clean up
        try store.deleteToken()
        let afterDelete = try store.retrieveToken()
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
}
