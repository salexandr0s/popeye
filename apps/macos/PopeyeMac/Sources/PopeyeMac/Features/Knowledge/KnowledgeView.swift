import AppKit
import PopeyeAPI
import SwiftUI

struct KnowledgeView: View {
  @Bindable var store: KnowledgeStore
  @Environment(AppModel.self) private var appModel

  var body: some View {
    rootContent
      .navigationTitle("Knowledge")
      .searchable(text: $store.searchText, placement: .toolbar, prompt: "Search knowledge...")
      .onSubmit(of: .search) {
        Task { await store.load() }
      }
      .toolbar {
        ToolbarItemGroup {
          Picker("Mode", selection: $store.mode) {
            ForEach(KnowledgeStore.Mode.allCases, id: \.self) { mode in
              Text(mode.title).tag(mode)
            }
          }
          .pickerStyle(.segmented)
          .frame(minWidth: 240, idealWidth: 280, maxWidth: 320)

          Button("Import", systemImage: "square.and.arrow.down") {
            store.showImportSheet = true
          }

          Button("Refresh", systemImage: "arrow.clockwise") {
            Task { await store.load() }
          }

          Button("Reingest", systemImage: "arrow.triangle.2.circlepath") {
            Task { await store.reingestSelectedSource() }
          }
          .disabled(store.selectedSource == nil || store.mutationState == .executing)

          Button("Review Draft", systemImage: "wand.and.stars") {
            Task { await store.reviewDraft() }
          }
          .disabled(!store.isEditable || !store.isDirty || store.revisionPhase.isLoading)

          Button("Discard", systemImage: "arrow.uturn.backward.circle") {
            store.discardLocalDraft()
          }
          .disabled(!store.isEditable || !store.isDirty || store.mutationState == .executing)

          Button("Reject", systemImage: "xmark.circle") {
            Task { await store.rejectReviewedDraft() }
          }
          .disabled(store.proposedRevision?.status != "draft" || store.mutationState == .executing)

          Button("Apply", systemImage: "checkmark.circle") {
            Task { await store.applyReviewedDraft() }
          }
          .disabled(store.proposedRevision == nil || store.mutationState == .executing)
        }
      }
      .popeyeRefreshable(invalidationSignals: [.general, .memory]) {
        await store.load()
      }
      .task(id: appModel.selectedWorkspaceID) {
        store.workspaceID = appModel.selectedWorkspaceID
        await store.load()
      }
      .onChange(of: store.mode) { _, _ in
        Task { await store.load() }
      }
      .onChange(of: store.selectedDocumentID) { _, newValue in
        guard let newValue else { return }
        Task { await store.loadDocument(id: newValue) }
      }
      .onChange(of: store.searchText) { _, newValue in
        if newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          Task { await store.load() }
        }
      }
      .sheet(isPresented: $store.showImportSheet) {
        KnowledgeImportSheet(store: store, workspaceID: appModel.selectedWorkspaceID)
      }
  }

  @ViewBuilder
  private var rootContent: some View {
    if store.loadPhase.isLoading && store.documents.isEmpty && store.sources.isEmpty {
      LoadingStateView(title: "Loading knowledge...")
    } else if let error = store.error, store.documents.isEmpty && store.sources.isEmpty {
      ErrorStateView(error: error) {
        Task { await store.load() }
      }
    } else {
      HSplitView {
        sidebar
          .popeyeSplitPane(minWidth: 260, idealWidth: 300, maxWidth: 360)
        centerPane
          .popeyeSplitPane(minWidth: 460, idealWidth: 640)
        inspectorPane
          .popeyeSplitPane(minWidth: 300, idealWidth: 360)
      }
      .overlay(alignment: .bottomTrailing) {
        MutationStateOverlay(state: store.mutationState, dismiss: store.dismissMutation)
          .padding(20)
      }
    }
  }

  private var sidebar: some View {
    VStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 12) {
        Text(appModel.selectedWorkspace?.name ?? appModel.selectedWorkspaceID)
          .font(.headline)
        Text("Markdown-first knowledge base with compile drafts, backlinks, and audits.")
          .font(.callout)
          .foregroundStyle(.secondary)

        if let audit = store.audit {
          HStack(spacing: 8) {
            StatusBadge(state: "\(audit.totalDocuments) docs")
            StatusBadge(state: "\(audit.totalDraftRevisions) drafts")
            if audit.unresolvedLinks > 0 {
              StatusBadge(state: "\(audit.unresolvedLinks) unresolved")
            }
          }
        }

        if !store.converters.isEmpty {
          converterHealthSummary
        }

        if let latestBetaRun = store.latestBetaRun {
          betaRunSummary(latestBetaRun)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(PopeyeUI.contentPadding)

      Divider()

      if store.documents.isEmpty {
        EmptyStateView(
          icon: "point.3.connected.trianglepath.dotted",
          title: "No \(store.mode.title.lowercased()) yet",
          description: store.mode == .wiki
            ? "Import a source to generate normalized markdown and a wiki draft."
            : "Imported knowledge items will appear here."
        )
      } else {
        List(store.documents, selection: $store.selectedDocumentID) { document in
          VStack(alignment: .leading, spacing: 6) {
            HStack {
              Text(document.title)
                .font(.headline)
              Spacer()
              StatusBadge(state: document.status)
            }
            Text(document.relativePath)
              .font(.caption)
              .foregroundStyle(.secondary)
              .lineLimit(2)
            if let source = store.sources.first(where: { $0.id == document.sourceId }) {
              Text(source.adapter.replacingOccurrences(of: "_", with: " "))
                .font(.caption2)
                .foregroundStyle(.tertiary)
            }
          }
          .padding(.vertical, 4)
          .tag(document.id)
        }
        .listStyle(.sidebar)
      }
    }
  }

  @ViewBuilder
  private var centerPane: some View {
    if let document = store.selectedDocumentDetail {
      VStack(alignment: .leading, spacing: 12) {
        header(document)

        if document.kind == KnowledgeStore.Mode.sources.kind {
          ScrollView {
            MarkdownPreviewView(markdown: document.markdownText)
              .padding(PopeyeUI.contentPadding)
          }
          .background(.background)
        } else {
          VSplitView {
            MacMarkdownEditor(text: $store.draftMarkdown)
              .frame(minHeight: 220, idealHeight: 300, maxHeight: .infinity)
              .padding(.horizontal, PopeyeUI.contentPadding)
              .padding(.top, 8)
            ScrollView {
              MarkdownPreviewView(
                markdown: store.proposedRevision?.proposedMarkdown ?? store.draftMarkdown
              )
              .padding(PopeyeUI.contentPadding)
            }
            .frame(minHeight: 220, idealHeight: 300, maxHeight: .infinity)
          }
        }
      }
    } else if store.detailPhase.isLoading {
      LoadingStateView(title: "Loading knowledge document...")
    } else {
      EmptyStateView(
        icon: "doc.text",
        title: "Select a document",
        description: "Choose a knowledge document to inspect its content, revisions, and links."
      )
    }
  }

  @ViewBuilder
  private var inspectorPane: some View {
    if let document = store.selectedDocumentDetail {
      ScrollView {
        VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
          summaryCard(document)
          if let source = store.selectedSource {
            sourceCard(source)
            sourceHistoryCard
          }
          revisionsCard
          linksCard
          compileCard
        }
        .padding(PopeyeUI.contentPadding)
      }
    } else {
      ContentUnavailableView(
        "Select a document", systemImage: "point.3.connected.trianglepath.dotted"
      )
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  @ViewBuilder
  private func header(_ document: KnowledgeDocumentDetailDTO) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .center) {
        VStack(alignment: .leading, spacing: 4) {
          Text(document.title)
            .font(.title2.weight(.semibold))
          Text(document.relativePath)
            .font(.callout)
            .foregroundStyle(.secondary)
        }
        Spacer()
        StatusBadge(state: document.kind)
      }
      if let error = store.detailError ?? store.revisionError ?? store.linkError {
        Text(error.userMessage)
          .font(.callout)
          .foregroundStyle(.red)
      }
      if let proposedRevision = store.proposedRevision {
        Text("Draft ready · \(DateFormatting.formatRelativeTime(proposedRevision.createdAt))")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.horizontal, PopeyeUI.contentPadding)
    .padding(.top, PopeyeUI.contentPadding)
  }

  private func summaryCard(_ document: KnowledgeDocumentDetailDTO) -> some View {
    GroupBox("Document") {
      VStack(alignment: .leading, spacing: 10) {
        LabeledContent("Slug", value: document.slug)
        LabeledContent("Status", value: document.status)
        LabeledContent("Updated", value: DateFormatting.formatRelativeTime(document.updatedAt))
        LabeledContent("Revision", value: document.revisionHash ?? "—")
        LabeledContent(
          "Sources",
          value: document.sourceIds.isEmpty ? "—" : document.sourceIds.joined(separator: ", "))
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private func sourceCard(_ source: KnowledgeSourceDTO) -> some View {
    GroupBox("Source") {
      VStack(alignment: .leading, spacing: 10) {
        LabeledContent("Type", value: source.sourceType)
        LabeledContent("Adapter", value: source.adapter)
        LabeledContent("Status", value: source.status)
        LabeledContent("Assets", value: source.assetStatus)
        LabeledContent("Latest import", value: source.latestOutcome)
        LabeledContent(
          "Original",
          value: source.originalUri ?? source.originalPath ?? source.originalFileName ?? "—")
        if !source.conversionWarnings.isEmpty {
          Divider()
          ForEach(source.conversionWarnings, id: \.self) { warning in
            Label(warning, systemImage: "exclamationmark.triangle")
              .font(.caption)
              .foregroundStyle(.orange)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var revisionsCard: some View {
    GroupBox("Revisions") {
      VStack(alignment: .leading, spacing: 10) {
        if let proposedRevision = store.proposedRevision {
          Text(proposedRevision.diffPreview)
            .font(.caption.monospaced())
            .textSelection(.enabled)
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
        }

        if store.revisions.isEmpty {
          Text("No revisions yet.")
            .font(.callout)
            .foregroundStyle(.secondary)
        } else {
          ForEach(Array(store.revisions.prefix(6))) { revision in
            VStack(alignment: .leading, spacing: 4) {
              HStack {
                Text(revision.sourceKind.replacingOccurrences(of: "_", with: " "))
                  .font(.subheadline.weight(.medium))
                Spacer()
                StatusBadge(state: revision.status)
              }
              Text(DateFormatting.formatRelativeTime(revision.createdAt))
                .font(.caption)
                .foregroundStyle(.secondary)
              if revision.status == "draft" {
                Button("Load Draft") {
                  store.proposedRevision = revision
                }
                .buttonStyle(.link)
                .font(.caption)
              }
            }
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var linksCard: some View {
    GroupBox("Links") {
      VStack(alignment: .leading, spacing: 12) {
        if let neighborhood = store.neighborhood {
          if neighborhood.incoming.isEmpty && neighborhood.outgoing.isEmpty {
            Text("No links yet.")
              .font(.callout)
              .foregroundStyle(.secondary)
          } else {
            if !neighborhood.outgoing.isEmpty {
              Text("Outgoing")
                .font(.subheadline.weight(.medium))
              ForEach(Array(neighborhood.outgoing.prefix(6))) { link in
                linkRow(link)
              }
            }
            if !neighborhood.incoming.isEmpty {
              Divider()
              Text("Backlinks")
                .font(.subheadline.weight(.medium))
              ForEach(Array(neighborhood.incoming.prefix(6))) { link in
                linkRow(link)
              }
            }
            if !neighborhood.relatedDocuments.isEmpty {
              Divider()
              Text("Related")
                .font(.subheadline.weight(.medium))
              ForEach(Array(neighborhood.relatedDocuments.prefix(6))) { document in
                Button {
                  Task { await store.openKnowledgeDocument(id: document.id, kind: document.kind) }
                } label: {
                  HStack {
                    VStack(alignment: .leading, spacing: 2) {
                      Text(document.title)
                        .font(.callout.weight(.medium))
                      Text(document.slug)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    Spacer()
                    StatusBadge(state: document.kind)
                  }
                }
                .buttonStyle(.plain)
              }
            }
          }
        }

        Divider()

        TextField("Link label", text: $store.newLinkLabel)
        TextField("Target slug (optional)", text: $store.newLinkSlug)
        Button("Add Related Link") {
          Task { await store.createLink() }
        }
        .disabled(
          store.newLinkLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || store.mutationState == .executing)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var compileCard: some View {
    GroupBox("Compile & Audit") {
      VStack(alignment: .leading, spacing: 10) {
        if let audit = store.audit {
          LabeledContent("Documents", value: "\(audit.totalDocuments)")
          LabeledContent("Drafts", value: "\(audit.totalDraftRevisions)")
          LabeledContent("Unresolved", value: "\(audit.unresolvedLinks)")
          LabeledContent("Broken", value: "\(audit.brokenLinks)")
          if let lastCompileAt = audit.lastCompileAt {
            LabeledContent("Last compile", value: DateFormatting.formatRelativeTime(lastCompileAt))
          }
        }
        if !store.selectedCompileJobs.isEmpty {
          Divider()
          ForEach(Array(store.selectedCompileJobs.prefix(4))) { job in
            VStack(alignment: .leading, spacing: 4) {
              HStack {
                Text(job.summary)
                  .font(.subheadline.weight(.medium))
                Spacer()
                StatusBadge(state: job.status)
              }
              Text(DateFormatting.formatRelativeTime(job.updatedAt))
                .font(.caption)
                .foregroundStyle(.secondary)
            }
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var sourceHistoryCard: some View {
    GroupBox("Source History") {
      VStack(alignment: .leading, spacing: 10) {
        if store.sourceSnapshots.isEmpty {
          Text("No snapshots yet.")
            .font(.callout)
            .foregroundStyle(.secondary)
        } else {
          ForEach(Array(store.sourceSnapshots.prefix(6))) { snapshot in
            VStack(alignment: .leading, spacing: 4) {
              HStack {
                Text(snapshot.outcome.capitalized)
                  .font(.subheadline.weight(.medium))
                Spacer()
                StatusBadge(state: snapshot.assetStatus)
              }
              Text("\(snapshot.adapter) · \(snapshot.status)")
                .font(.caption)
                .foregroundStyle(.secondary)
              Text(DateFormatting.formatRelativeTime(snapshot.createdAt))
                .font(.caption2)
                .foregroundStyle(.tertiary)
              if !snapshot.conversionWarnings.isEmpty {
                Text(snapshot.conversionWarnings.joined(separator: " • "))
                  .font(.caption2)
                  .foregroundStyle(.orange)
                  .lineLimit(3)
              }
            }
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private func linkRow(_ link: KnowledgeLinkDTO) -> some View {
    Button {
      Task { await store.openKnowledgeLink(link) }
    } label: {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 2) {
          Text(link.targetLabel)
            .font(.callout.weight(.medium))
          if let targetSlug = link.targetSlug, !targetSlug.isEmpty {
            Text(targetSlug)
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
        Spacer()
        StatusBadge(state: link.linkStatus)
      }
    }
    .buttonStyle(.plain)
  }

  private var converterHealthSummary: some View {
    let missing = store.converters.filter { $0.status == "missing" }.count
    let degraded = store.converters.filter { $0.status == "degraded" }.count
    let ready = store.converters.filter { $0.status == "ready" }.count
    return VStack(alignment: .leading, spacing: 8) {
      Text("Converter Health")
        .font(.subheadline.weight(.semibold))
      HStack(spacing: 8) {
        StatusBadge(state: "\(ready) ready")
        if degraded > 0 { StatusBadge(state: "\(degraded) degraded") }
        if missing > 0 { StatusBadge(state: "\(missing) missing") }
      }
      ForEach(Array(store.converters.prefix(4))) { converter in
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: 2) {
            Text(converter.id.replacingOccurrences(of: "_", with: " "))
              .font(.caption.weight(.medium))
            Text(converter.provenance.capitalized)
              .font(.caption2.weight(.semibold))
              .foregroundStyle(.tertiary)
            Text(converter.details)
              .font(.caption2)
              .foregroundStyle(.secondary)
              .lineLimit(2)
            if let installHint = converter.installHint, converter.status != "ready", converter.provenance != "bundled" {
              Text(installHint)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .lineLimit(2)
            }
          }
          Spacer()
          StatusBadge(state: converter.status)
        }
      }
    }
  }

  private func betaRunSummary(_ betaRun: KnowledgeBetaRunDetailDTO) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Latest Beta Run")
        .font(.subheadline.weight(.semibold))
      HStack(spacing: 8) {
        StatusBadge(state: betaRun.gate.status)
        StatusBadge(state: "\(Int((betaRun.importSuccessRate * 100).rounded()))% success")
      }
      Text(betaRun.manifestPath ?? "No manifest path recorded")
        .font(.caption2)
        .foregroundStyle(.secondary)
        .lineLimit(2)
      Text(
        "\(betaRun.importCount) imports · \(betaRun.reingestCount) reingests · \(betaRun.hardFailureCount) hard failures"
      )
      .font(.caption)
      .foregroundStyle(.secondary)
      Text("Updated \(DateFormatting.formatRelativeTime(betaRun.createdAt))")
        .font(.caption2)
        .foregroundStyle(.tertiary)

      if store.betaIssues.isEmpty {
        Text("No degraded imports or hard failures in the latest beta run.")
          .font(.caption)
          .foregroundStyle(.secondary)
      } else {
        Divider()
        ForEach(Array(store.betaIssues.prefix(3).enumerated()), id: \.offset) { _, issue in
          VStack(alignment: .leading, spacing: 2) {
            Text(issue.label)
              .font(.caption.weight(.medium))
            Text(issue.error ?? [issue.outcome, issue.status, issue.assetStatus].compactMap { $0 }.joined(separator: " · "))
              .font(.caption2)
              .foregroundStyle(.secondary)
              .lineLimit(2)
          }
        }
      }
    }
  }
}

private struct KnowledgeImportSheet: View {
  @Environment(\.dismiss) private var dismiss
  @Bindable var store: KnowledgeStore
  let workspaceID: String

  @State private var sourceType = "manual_text"
  @State private var title = ""
  @State private var sourceURI = ""
  @State private var sourcePath = ""
  @State private var sourceText = ""

  private let sourceTypes = [
    "manual_text", "website", "pdf", "local_file", "repo", "dataset", "image", "x_post",
  ]

  var body: some View {
    NavigationStack {
      Form {
        Picker("Source Type", selection: $sourceType) {
          ForEach(sourceTypes, id: \.self) { type in
            Text(type.replacingOccurrences(of: "_", with: " ").capitalized).tag(type)
          }
        }

        TextField("Title", text: $title)

        if sourceType == "manual_text" {
          TextField("Source text", text: $sourceText, axis: .vertical)
            .lineLimit(8, reservesSpace: true)
        } else if sourceType == "website" || sourceType == "x_post" {
          TextField("URL", text: $sourceURI)
        } else {
          HStack {
            TextField("Local path or file path", text: $sourcePath)
            Button(canChooseDirectory ? "Choose Folder" : "Choose File") {
              if let pickedPath = chooseLocalPath() {
                sourcePath = pickedPath
              }
            }
          }
        }

        if !converterChain.isEmpty {
          Section("Converter chain") {
            ForEach(converterChain, id: \.self) { converterID in
              let availability = store.converters.first(where: { $0.id == converterID })
              HStack {
                VStack(alignment: .leading, spacing: 2) {
                  Text(converterID.replacingOccurrences(of: "_", with: " ").capitalized)
                  if let availability {
                    Text(availability.provenance.capitalized)
                      .font(.caption2.weight(.semibold))
                      .foregroundStyle(.tertiary)
                    Text(availability.details)
                      .font(.caption)
                      .foregroundStyle(.secondary)
                    if let installHint = availability.installHint, availability.status != "ready", availability.provenance != "bundled" {
                      Text(installHint)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    }
                  }
                }
                Spacer()
                if let availability {
                  StatusBadge(state: availability.status)
                } else {
                  StatusBadge(state: "unknown")
                }
              }
            }
          }
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Import Knowledge Source")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Import") {
            Task {
              await store.importSource(
                KnowledgeImportInput(
                  workspaceId: workspaceID,
                  sourceType: sourceType,
                  title: title,
                  sourceUri: sourceURI.nilIfBlank,
                  sourcePath: sourcePath.nilIfBlank,
                  sourceText: sourceText.nilIfBlank
                )
              )
              dismiss()
            }
          }
          .disabled(
            title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !hasRequiredContent)
        }
      }
    }
    .frame(minWidth: 520, minHeight: 320)
  }

  private var hasRequiredContent: Bool {
    switch sourceType {
    case "manual_text": !sourceText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    case "website", "x_post": !sourceURI.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    default: !sourcePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
  }

  private var converterChain: [String] {
    switch sourceType {
    case "website", "x_post":
      ["jina_reader", "trafilatura"]
    case "local_file", "pdf", "image":
      ["markitdown", "docling"]
    default:
      []
    }
  }

  private var canChooseDirectory: Bool {
    sourceType == "repo"
  }

  private func chooseLocalPath() -> String? {
    let panel = NSOpenPanel()
    panel.canChooseFiles = !canChooseDirectory
    panel.canChooseDirectories = canChooseDirectory
    panel.canCreateDirectories = false
    panel.allowsMultipleSelection = false
    return panel.runModal() == .OK ? panel.urls.first?.path : nil
  }
}

extension String {
  var nilIfBlank: String? {
    let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }
}
