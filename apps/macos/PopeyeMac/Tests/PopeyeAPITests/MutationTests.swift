import Testing
import Foundation
@testable import PopeyeAPI

@Suite("Mutation Eligibility")
struct MutationEligibilityTests {

    // MARK: - Run Mutations

    @Test("Can retry failed_retryable run")
    func retryFailedRetryable() {
        #expect(MutationEligibility.canRetryRun(state: "failed_retryable"))
    }

    @Test("Can retry failed_final run")
    func retryFailedFinal() {
        #expect(MutationEligibility.canRetryRun(state: "failed_final"))
    }

    @Test("Can retry cancelled run")
    func retryCancelled() {
        #expect(MutationEligibility.canRetryRun(state: "cancelled"))
    }

    @Test("Can retry abandoned run")
    func retryAbandoned() {
        #expect(MutationEligibility.canRetryRun(state: "abandoned"))
    }

    @Test("Cannot retry running run")
    func cannotRetryRunning() {
        #expect(!MutationEligibility.canRetryRun(state: "running"))
    }

    @Test("Cannot retry starting run")
    func cannotRetryStarting() {
        #expect(!MutationEligibility.canRetryRun(state: "starting"))
    }

    @Test("Can cancel starting run")
    func cancelStarting() {
        #expect(MutationEligibility.canCancelRun(state: "starting"))
    }

    @Test("Can cancel running run")
    func cancelRunning() {
        #expect(MutationEligibility.canCancelRun(state: "running"))
    }

    @Test("Cannot cancel failed run")
    func cannotCancelFailed() {
        #expect(!MutationEligibility.canCancelRun(state: "failed_final"))
    }

    // MARK: - Job Mutations

    @Test("Can pause queued job")
    func pauseQueued() {
        #expect(MutationEligibility.canPauseJob(status: "queued"))
    }

    @Test("Can pause running job")
    func pauseRunning() {
        #expect(MutationEligibility.canPauseJob(status: "running"))
    }

    @Test("Cannot pause paused job")
    func cannotPausePaused() {
        #expect(!MutationEligibility.canPauseJob(status: "paused"))
    }

    @Test("Can resume paused job")
    func resumePaused() {
        #expect(MutationEligibility.canResumeJob(status: "paused"))
    }

    @Test("Cannot resume running job")
    func cannotResumeRunning() {
        #expect(!MutationEligibility.canResumeJob(status: "running"))
    }

    @Test("Can enqueue blocked_operator job")
    func enqueueBlocked() {
        #expect(MutationEligibility.canEnqueueJob(status: "blocked_operator"))
    }

    @Test("Can enqueue paused job")
    func enqueuePaused() {
        #expect(MutationEligibility.canEnqueueJob(status: "paused"))
    }

    @Test("Cannot enqueue running job")
    func cannotEnqueueRunning() {
        #expect(!MutationEligibility.canEnqueueJob(status: "running"))
    }

    // MARK: - Intervention Mutations

    @Test("Can resolve open intervention")
    func resolveOpen() {
        #expect(MutationEligibility.canResolveIntervention(status: "open"))
    }

    @Test("Cannot resolve already resolved intervention")
    func cannotResolveResolved() {
        #expect(!MutationEligibility.canResolveIntervention(status: "resolved"))
    }

    // MARK: - Approval Mutations

    @Test("Can resolve pending approval")
    func resolvePending() {
        #expect(MutationEligibility.canResolveApproval(status: "pending"))
    }

    @Test("Cannot resolve approved approval")
    func cannotResolveApproved() {
        #expect(!MutationEligibility.canResolveApproval(status: "approved"))
    }

    @Test("Cannot resolve denied approval")
    func cannotResolveDenied() {
        #expect(!MutationEligibility.canResolveApproval(status: "denied"))
    }

    // MARK: - Telegram Delivery Mutations

    @Test("Can resolve uncertain telegram delivery")
    func resolveUncertainDelivery() {
        #expect(MutationEligibility.canResolveTelegramDelivery(status: "uncertain"))
    }

    @Test("Can resolve pending telegram delivery")
    func resolvePendingDelivery() {
        #expect(MutationEligibility.canResolveTelegramDelivery(status: "pending"))
    }

    @Test("Cannot resolve sending telegram delivery")
    func cannotResolveSendingDelivery() {
        #expect(!MutationEligibility.canResolveTelegramDelivery(status: "sending"))
    }

    @Test("Cannot resolve sent telegram delivery")
    func cannotResolveSentDelivery() {
        #expect(!MutationEligibility.canResolveTelegramDelivery(status: "sent"))
    }

    @Test("Cannot resolve abandoned telegram delivery")
    func cannotResolveAbandonedDelivery() {
        #expect(!MutationEligibility.canResolveTelegramDelivery(status: "abandoned"))
    }
}

@Suite("Mutation Inputs Encoding")
struct MutationInputsEncodingTests {
    let encoder = JSONEncoder()

    @Test("Encode InterventionResolveInput with note")
    func encodeInterventionWithNote() throws {
        let input = InterventionResolveInput(resolutionNote: "Resolved via dashboard")
        let data = try encoder.encode(input)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        #expect(dict["resolutionNote"] as? String == "Resolved via dashboard")
    }

    @Test("Encode InterventionResolveInput without note omits key")
    func encodeInterventionWithoutNote() throws {
        let input = InterventionResolveInput()
        let data = try encoder.encode(input)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        #expect(dict["resolutionNote"] == nil)
    }

    @Test("Encode ApprovalResolveInput approved with reason")
    func encodeApprovalApproved() throws {
        let input = ApprovalResolveInput(decision: "approved", decisionReason: "Looks safe")
        let data = try encoder.encode(input)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        #expect(dict["decision"] as? String == "approved")
        #expect(dict["decisionReason"] as? String == "Looks safe")
    }

    @Test("Encode ApprovalResolveInput denied without reason omits key")
    func encodeApprovalDenied() throws {
        let input = ApprovalResolveInput(decision: "denied")
        let data = try encoder.encode(input)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        #expect(dict["decision"] as? String == "denied")
        #expect(dict["decisionReason"] == nil)
    }
}
