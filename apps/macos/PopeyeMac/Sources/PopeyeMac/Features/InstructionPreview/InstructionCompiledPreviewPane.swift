import SwiftUI
import PopeyeAPI

struct InstructionCompiledPreviewPane: View {
    @Environment(AppModel.self) private var appModel
    let preview: InstructionPreviewDTO

    var body: some View {
        ScrollView {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: PopeyeUI.splitColumnSpacing) {
                    summaryColumn
                        .frame(width: 320)
                    InstructionPreviewCompiledTextSection(text: preview.compiledText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                    summaryColumn
                    InstructionPreviewCompiledTextSection(text: preview.compiledText)
                }
            }
            .padding(PopeyeUI.contentPadding)
        }
    }

    private var summaryColumn: some View {
        VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
            InstructionPreviewMetadataSection(preview: preview)
            if preview.warnings.isEmpty == false {
                InstructionPreviewWarningsSection(warnings: preview.warnings)
            }
            if preview.playbooks.isEmpty == false {
                InstructionPreviewPlaybooksSection(
                    playbooks: preview.playbooks,
                    openPlaybook: { playbook in
                        appModel.navigateToAppliedPlaybook(id: playbook.id, scope: playbook.scope)
                    }
                )
            }
            InstructionPreviewSourcesSection(sources: preview.sources)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
