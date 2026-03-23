/// Pure-logic state eligibility checks for mutation actions.
/// Lives in PopeyeAPI so both stores and tests can reference them.
public enum MutationEligibility {
    // MARK: - Runs

    public static func canRetryRun(state: String) -> Bool {
        ["failed_retryable", "failed_final", "cancelled", "abandoned"].contains(state)
    }

    public static func canCancelRun(state: String) -> Bool {
        ["starting", "running"].contains(state)
    }

    // MARK: - Jobs

    public static func canPauseJob(status: String) -> Bool {
        ["queued", "running"].contains(status)
    }

    public static func canResumeJob(status: String) -> Bool {
        ["paused"].contains(status)
    }

    public static func canEnqueueJob(status: String) -> Bool {
        ["blocked_operator", "paused"].contains(status)
    }

    // MARK: - Interventions

    public static func canResolveIntervention(status: String) -> Bool {
        status == "open"
    }

    // MARK: - Approvals

    public static func canResolveApproval(status: String) -> Bool {
        status == "pending"
    }
}
