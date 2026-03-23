import Foundation

public struct OperationsService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadRuns() async throws -> [RunRecordDTO] {
        try await client.listRuns()
    }

    public func loadJobs() async throws -> [JobRecordDTO] {
        try await client.listJobs()
    }

    public func loadTasks() async throws -> [TaskRecordDTO] {
        try await client.listTasks()
    }

    public func loadReceipts() async throws -> [ReceiptRecordDTO] {
        try await client.listReceipts()
    }

    public func loadRunDetail(id: String) async throws -> RunDetailSnapshot {
        async let run = client.getRun(id: id)
        async let events = client.getRunEvents(id: id)
        async let envelope: ExecutionEnvelopeDTO? = try? client.getRunEnvelope(id: id)
        async let receipt: ReceiptRecordDTO? = try? client.getRunReceipt(runId: id)
        async let reply: RunReplyDTO? = try? client.getRunReply(id: id)

        return RunDetailSnapshot(
            run: try await run,
            events: try await events,
            envelope: await envelope,
            receipt: await receipt,
            reply: await reply
        )
    }

    public func loadReceiptDetail(id: String) async throws -> ReceiptRecordDTO {
        try await client.getReceipt(id: id)
    }

    public func loadJobDetail(id: String) async throws -> JobDetailSnapshot {
        async let job = client.getJob(id: id)
        async let lease: JobLeaseDTO? = try? client.getJobLease(id: id)
        return JobDetailSnapshot(job: try await job, lease: await lease)
    }
}

public struct RunDetailSnapshot: Sendable {
    public let run: RunRecordDTO
    public let events: [RunEventDTO]
    public let envelope: ExecutionEnvelopeDTO?
    public let receipt: ReceiptRecordDTO?
    public let reply: RunReplyDTO?

    public init(
        run: RunRecordDTO,
        events: [RunEventDTO],
        envelope: ExecutionEnvelopeDTO?,
        receipt: ReceiptRecordDTO?,
        reply: RunReplyDTO?
    ) {
        self.run = run
        self.events = events
        self.envelope = envelope
        self.receipt = receipt
        self.reply = reply
    }
}

public struct JobDetailSnapshot: Sendable {
    public let job: JobRecordDTO
    public let lease: JobLeaseDTO?

    public init(job: JobRecordDTO, lease: JobLeaseDTO?) {
        self.job = job
        self.lease = lease
    }
}
