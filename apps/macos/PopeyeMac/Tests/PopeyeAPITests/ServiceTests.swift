import Testing
import Foundation
@testable import PopeyeAPI

@Suite("SystemService")
struct ServiceTests {
    @Test("DashboardSnapshot fields match DTOs")
    func snapshotFields() {
        let status = DaemonStatusDTO(
            ok: true, runningJobs: 2, queuedJobs: 1,
            openInterventions: 0, activeLeases: 2,
            engineKind: "pi", schedulerRunning: true,
            startedAt: "2026-03-22T10:00:00Z", lastShutdownAt: nil
        )
        let scheduler = SchedulerStatusDTO(
            running: true, activeLeases: 2, activeRuns: 1,
            nextHeartbeatDueAt: "2026-03-22T10:05:00Z"
        )
        let capabilities = EngineCapabilitiesDTO(
            engineKind: "pi", persistentSessionSupport: true,
            resumeBySessionRefSupport: true, hostToolMode: "native",
            compactionEventSupport: true, cancellationMode: "rpc_abort",
            acceptedRequestMetadata: [], warnings: []
        )
        let usage = UsageSummaryDTO(
            runs: 42, tokensIn: 150000, tokensOut: 80000,
            estimatedCostUsd: 3.45
        )
        let audit = SecurityAuditDTO(findings: [])

        let snapshot = DashboardSnapshot(
            status: status, scheduler: scheduler,
            capabilities: capabilities, usage: usage,
            securityAudit: audit
        )

        #expect(snapshot.status.runningJobs == 2)
        #expect(snapshot.scheduler.running == true)
        #expect(snapshot.capabilities.engineKind == "pi")
        #expect(snapshot.usage.estimatedCostUsd == 3.45)
        #expect(snapshot.securityAudit?.findings.isEmpty == true)
    }

    @Test("DashboardSnapshot with nil audit")
    func snapshotNilAudit() {
        let snapshot = DashboardSnapshot(
            status: DaemonStatusDTO(
                ok: true, runningJobs: 0, queuedJobs: 0,
                openInterventions: 0, activeLeases: 0,
                engineKind: "fake", schedulerRunning: false,
                startedAt: "2026-03-22T10:00:00Z", lastShutdownAt: nil
            ),
            scheduler: SchedulerStatusDTO(
                running: false, activeLeases: 0, activeRuns: 0,
                nextHeartbeatDueAt: nil
            ),
            capabilities: EngineCapabilitiesDTO(
                engineKind: "fake", persistentSessionSupport: false,
                resumeBySessionRefSupport: false, hostToolMode: "none",
                compactionEventSupport: false, cancellationMode: "none",
                acceptedRequestMetadata: [], warnings: []
            ),
            usage: UsageSummaryDTO(
                runs: 0, tokensIn: 0, tokensOut: 0,
                estimatedCostUsd: 0
            ),
            securityAudit: nil
        )

        #expect(snapshot.securityAudit == nil)
        #expect(snapshot.status.ok == true)
    }
}
