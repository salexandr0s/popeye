import Foundation
import PopeyeAPI

extension SetupStore {
    func executeOAuthAction(
        kind: SetupOAuthActionKind,
        providerKind: String,
        connectionId: String?,
        cardID: SetupCardID
    ) async {
        clearActionError()
        activity = .oauthStarting(cardID: cardID, kind: kind)

        do {
            let session = try await connectionsService.startOAuthConnection(
                providerKind: providerKind,
                connectionId: connectionId,
                mode: "read_only",
                syncIntervalSeconds: 900
            )

            guard let url = URL(string: session.authorizationUrl) else {
                throw SetupActionError.invalidAuthorizationURL
            }

            guard openURL(url) else {
                throw SetupActionError.browserLaunchFailed
            }

            activity = .oauthWaiting(cardID: cardID, kind: kind)
            try await waitForOAuthCompletion(sessionID: session.id)
            await load()
            emitInvalidation(.connections)
        } catch let apiError as APIError {
            setActionError(apiError.userMessage, for: cardID)
        } catch let actionError as SetupActionError {
            setActionError(actionError.errorDescription, for: cardID)
        } catch {
            setActionError("Provider setup failed.", for: cardID)
        }

        activity = nil
    }

    func waitForOAuthCompletion(sessionID: String) async throws {
        let deadline = ContinuousClock.now + oauthTimeout

        while ContinuousClock.now < deadline {
            let session = try await connectionsService.loadOAuthSession(id: sessionID)

            switch session.status {
            case "completed":
                return
            case "failed":
                throw SetupActionError.oauthFailed(session.error ?? "The provider authorization failed.")
            case "expired":
                throw SetupActionError.oauthExpired
            default:
                await sleep(oauthPollInterval)
            }
        }

        throw SetupActionError.oauthTimedOut
    }
}
