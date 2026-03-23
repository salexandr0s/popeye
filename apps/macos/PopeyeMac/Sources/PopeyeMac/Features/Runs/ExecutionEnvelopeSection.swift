import SwiftUI
import PopeyeAPI

struct ExecutionEnvelopeSection: View {
    let envelope: ExecutionEnvelopeDTO

    var body: some View {
        InspectorSection(title: "Execution Envelope") {
            keyValueGrid
            if !envelope.allowedRuntimeTools.isEmpty {
                toolsList
            }
            if !envelope.allowedCapabilityIds.isEmpty {
                capabilitiesList
            }
            if !envelope.provenance.warnings.isEmpty {
                warningsList
            }
            rootsList
        }
    }

    private var keyValueGrid: some View {
        VStack(alignment: .leading, spacing: 4) {
            DetailRow(label: "Mode", value: envelope.mode)
            DetailRow(label: "FS Policy", value: envelope.filesystemPolicyClass)
            DetailRow(label: "Memory Scope", value: envelope.memoryScope)
            DetailRow(label: "Recall Scope", value: envelope.recallScope)
            DetailRow(label: "Context Release", value: envelope.contextReleasePolicy)
            DetailRow(label: "Session Policy", value: envelope.provenance.sessionPolicy)
            DetailRow(label: "Model Policy", value: envelope.modelPolicy)
        }
    }

    private var toolsList: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Tools")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            FlowText(items: envelope.allowedRuntimeTools)
        }
    }

    private var capabilitiesList: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Capabilities")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            FlowText(items: envelope.allowedCapabilityIds)
        }
    }

    private var warningsList: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Warnings")
                .font(.caption.bold())
                .foregroundStyle(.orange)
            ForEach(envelope.provenance.warnings, id: \.self) { warning in
                Text(warning)
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
    }

    private var rootsList: some View {
        VStack(alignment: .leading, spacing: 4) {
            if !envelope.readRoots.isEmpty {
                Text("Read Roots")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                ForEach(envelope.readRoots, id: \.self) { root in
                    Text(root)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }
            if !envelope.writeRoots.isEmpty {
                Text("Write Roots")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                ForEach(envelope.writeRoots, id: \.self) { root in
                    Text(root)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

private struct FlowText: View {
    let items: [String]

    var body: some View {
        Text(items.joined(separator: ", "))
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
    }
}
