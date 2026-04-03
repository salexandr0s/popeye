import Testing
import Foundation
import PopeyeAPI

@Suite("Mutation State Machine")
struct MutationStateMachineTests {

    @Test("Initial state is idle")
    func initialState() {
        let state: MutationState = .idle
        #expect(state == .idle)
    }

    @Test("Executing state is not idle")
    func executingNotIdle() {
        let state: MutationState = .executing
        #expect(state != .idle)
    }

    @Test("Succeeded state carries message")
    func succeededMessage() {
        let state: MutationState = .succeeded("Run cancelled")
        if case .succeeded(let msg) = state {
            #expect(msg == "Run cancelled")
        } else {
            Issue.record("Expected succeeded state")
        }
    }

    @Test("Failed state carries message")
    func failedMessage() {
        let state: MutationState = .failed("Cancel failed")
        if case .failed(let msg) = state {
            #expect(msg == "Cancel failed")
        } else {
            Issue.record("Expected failed state")
        }
    }

    @Test("Succeeded and failed are not equal")
    func succeededNotEqualFailed() {
        #expect(MutationState.succeeded("done") != MutationState.failed("done"))
    }

    @Test("Same succeeded messages are equal")
    func sameSucceededEqual() {
        #expect(MutationState.succeeded("ok") == MutationState.succeeded("ok"))
    }
}

@Suite("APIError User Messages")
struct APIErrorUserMessageTests {

    @Test("Transport unavailable message")
    func transportMessage() {
        #expect(APIError.transportUnavailable.userMessage.contains("daemon"))
    }

    @Test("Unauthorized message")
    func unauthorizedMessage() {
        #expect(APIError.unauthorized.userMessage.contains("credential"))
    }

    @Test("Forbidden message")
    func forbiddenMessage() {
        #expect(APIError.forbidden.userMessage.contains("permission"))
    }

    @Test("CSRF invalid message")
    func csrfMessage() {
        #expect(APIError.csrfInvalid.userMessage.contains("CSRF"))
    }

    @Test("Not found message")
    func notFoundMessage() {
        #expect(APIError.notFound.userMessage.contains("not found"))
    }

    @Test("Decode failure includes detail")
    func decodeFailureMessage() {
        let error = APIError.decodeFailure(message: "missing field")
        #expect(error.userMessage.contains("missing field"))
    }

    @Test("API failure includes status code")
    func apiFailureMessage() {
        let error = APIError.apiFailure(statusCode: 409, message: "conflict")
        #expect(error.userMessage.contains("409"))
        #expect(error.userMessage.contains("conflict"))
    }
}

@Suite("Mutation Eligibility — Comprehensive")
struct MutationEligibilityComprehensiveTests {

    static let runStates = [
        "starting", "running", "succeeded", "failed_retryable", "failed_final",
        "cancelled", "abandoned"
    ]

    static let jobStatuses = [
        "queued", "running", "paused", "blocked_operator", "succeeded",
        "failed_final", "cancelled"
    ]

    @Test("Run states: retry and cancel are mutually exclusive")
    func runStatesMutuallyExclusive() {
        for state in Self.runStates {
            let canRetry = MutationEligibility.canRetryRun(state: state)
            let canCancel = MutationEligibility.canCancelRun(state: state)
            #expect(!(canRetry && canCancel), "State '\(state)' is both retryable and cancellable")
        }
    }

    @Test("Job statuses: pause and resume are mutually exclusive")
    func jobStatusesMutuallyExclusive() {
        for status in Self.jobStatuses {
            let canPause = MutationEligibility.canPauseJob(status: status)
            let canResume = MutationEligibility.canResumeJob(status: status)
            #expect(!(canPause && canResume), "Status '\(status)' is both pausable and resumable")
        }
    }

    @Test("Succeeded runs have no available mutations")
    func succeededRunNoMutations() {
        #expect(!MutationEligibility.canRetryRun(state: "succeeded"))
        #expect(!MutationEligibility.canCancelRun(state: "succeeded"))
    }

    @Test("Succeeded jobs have no available mutations")
    func succeededJobNoMutations() {
        #expect(!MutationEligibility.canPauseJob(status: "succeeded"))
        #expect(!MutationEligibility.canResumeJob(status: "succeeded"))
        #expect(!MutationEligibility.canEnqueueJob(status: "succeeded"))
    }

    @Test("Unknown state returns false for all eligibility checks")
    func unknownState() {
        #expect(!MutationEligibility.canRetryRun(state: "unknown_state"))
        #expect(!MutationEligibility.canCancelRun(state: "unknown_state"))
        #expect(!MutationEligibility.canPauseJob(status: "unknown_state"))
        #expect(!MutationEligibility.canResumeJob(status: "unknown_state"))
        #expect(!MutationEligibility.canEnqueueJob(status: "unknown_state"))
        #expect(!MutationEligibility.canResolveIntervention(status: "unknown_state"))
        #expect(!MutationEligibility.canResolveApproval(status: "unknown_state"))
    }
}
