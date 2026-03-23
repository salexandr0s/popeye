import SwiftUI
import PopeyeAPI

struct ReceiptRuntimeSection: View {
    let runtime: ReceiptRuntimeDTO

    var body: some View {
        InspectorSection(title: "Runtime") {
            if let projectId = runtime.projectId {
                DetailRow(label: "Project", value: IdentifierFormatting.formatShortID(projectId))
            }
            if let profileId = runtime.profileId {
                DetailRow(label: "Profile", value: IdentifierFormatting.formatShortID(profileId))
            }
            if let exec = runtime.execution {
                DetailRow(label: "Mode", value: exec.mode)
                DetailRow(label: "Session Policy", value: exec.sessionPolicy)
                DetailRow(label: "Memory Scope", value: exec.memoryScope)
                DetailRow(label: "FS Policy", value: exec.filesystemPolicyClass)
                DetailRow(label: "Context Release", value: exec.contextReleasePolicy)
            }
            if let ctx = runtime.contextReleases {
                DetailRow(label: "Releases", value: "\(ctx.totalReleases)")
                DetailRow(label: "Release Tokens", value: IdentifierFormatting.formatTokenCount(ctx.totalTokenEstimate))
            }
        }
    }
}
