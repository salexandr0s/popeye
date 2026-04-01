import Foundation
import PopeyeAPI

struct BrainInstructionSourceGroup: Identifiable {
    let type: String
    let sources: [InstructionSourceDTO]

    var id: String { type }
}

struct BrainSnapshot {
    let identities: [IdentityRecordDTO]
    let defaultIdentity: WorkspaceIdentityDefaultDTO?
    let preview: InstructionPreviewDTO?

    var activeIdentityID: String {
        defaultIdentity?.identityId
            ?? identities.first(where: \.selected)?.id
            ?? "default"
    }

    var activeIdentityRecord: IdentityRecordDTO? {
        identities.first { $0.id == activeIdentityID }
    }

    var soulSource: InstructionSourceDTO? {
        preview?.sources.first { $0.type == "soul" }
    }

    var identitySources: [InstructionSourceDTO] {
        sortedSources.filter { $0.type == "identity" }
    }

    var playbooks: [AppliedPlaybookDTO] {
        preview?.playbooks ?? []
    }

    var warnings: [String] {
        preview?.warnings ?? []
    }

    var sortedSources: [InstructionSourceDTO] {
        (preview?.sources ?? []).sorted { left, right in
            if left.precedence != right.precedence {
                return left.precedence < right.precedence
            }
            return (left.path ?? left.inlineId ?? left.type) < (right.path ?? right.inlineId ?? right.type)
        }
    }

    var sourceGroups: [BrainInstructionSourceGroup] {
        Dictionary(grouping: sortedSources, by: \.type)
            .map { BrainInstructionSourceGroup(type: $0.key, sources: $0.value) }
            .sorted { left, right in
                guard let leftPrecedence = left.sources.first?.precedence,
                      let rightPrecedence = right.sources.first?.precedence else {
                    return left.type < right.type
                }
                if leftPrecedence != rightPrecedence {
                    return leftPrecedence < rightPrecedence
                }
                return left.type < right.type
            }
    }
}
