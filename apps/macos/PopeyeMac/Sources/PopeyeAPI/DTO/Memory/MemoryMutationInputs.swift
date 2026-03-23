import Foundation

public struct MemoryPinInput: Encodable, Sendable {
    public let targetKind: String // fact | synthesis
    public let reason: String?

    public init(targetKind: String, reason: String? = nil) {
        self.targetKind = targetKind
        self.reason = reason
    }
}

public struct MemoryForgetInput: Encodable, Sendable {
    public let reason: String?

    public init(reason: String? = nil) {
        self.reason = reason
    }
}

public struct MemoryPromotionProposeInput: Encodable, Sendable {
    public let targetPath: String

    public init(targetPath: String) {
        self.targetPath = targetPath
    }
}

public struct MemoryPromotionExecuteInput: Encodable, Sendable {
    public let targetPath: String
    public let diff: String
    public let approved: Bool
    public let promoted: Bool

    public init(targetPath: String, diff: String, approved: Bool = true, promoted: Bool = true) {
        self.targetPath = targetPath
        self.diff = diff
        self.approved = approved
        self.promoted = promoted
    }
}
