import SwiftUI
import PopeyeAPI

struct FileRootEditorSheet: View {
    let workspaceID: String
    let existingRoot: FileRootDTO?
    let onCreate: (FileRootRegistrationInput) -> Void
    let onUpdate: (String, FileRootUpdateInput) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var label: String
    @State private var rootPath: String
    @State private var permission: String
    @State private var filePatterns: String
    @State private var excludePatterns: String
    @State private var maxFileSizeBytes: String
    @State private var enabled: Bool

    init(
        workspaceID: String,
        existingRoot: FileRootDTO?,
        onCreate: @escaping (FileRootRegistrationInput) -> Void,
        onUpdate: @escaping (String, FileRootUpdateInput) -> Void
    ) {
        self.workspaceID = workspaceID
        self.existingRoot = existingRoot
        self.onCreate = onCreate
        self.onUpdate = onUpdate
        _label = State(initialValue: existingRoot?.label ?? "")
        _rootPath = State(initialValue: existingRoot?.rootPath ?? "")
        _permission = State(initialValue: existingRoot?.permission ?? "index")
        _filePatterns = State(initialValue: existingRoot?.filePatterns.joined(separator: ", ") ?? "**/*.md, **/*.txt")
        _excludePatterns = State(initialValue: existingRoot?.excludePatterns.joined(separator: ", ") ?? "")
        _maxFileSizeBytes = State(initialValue: String(existingRoot?.maxFileSizeBytes ?? 1_048_576))
        _enabled = State(initialValue: existingRoot?.enabled ?? true)
    }

    private var parsedMaxFileSize: Int? {
        Int(maxFileSizeBytes.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private var canSave: Bool {
        label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            && (existingRoot != nil || rootPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
            && parsedMaxFileSize != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(existingRoot == nil ? "Add File Root" : "Edit File Root")
                .font(.title3.bold())
                .padding(20)

            Form {
                TextField("Label", text: $label)

                if existingRoot == nil {
                    TextField("Root Path", text: $rootPath)
                } else {
                    LabeledContent("Root Path") {
                        Text(rootPath)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                }

                Picker("Permission", selection: $permission) {
                    Text("Read").tag("read")
                    Text("Index").tag("index")
                    Text("Index + Derive").tag("index_and_derive")
                }

                TextField("File Patterns", text: $filePatterns, prompt: Text("**/*.md, **/*.txt"))
                TextField("Exclude Patterns", text: $excludePatterns, prompt: Text(".git/**, node_modules/**"))
                TextField("Max File Size (bytes)", text: $maxFileSizeBytes)

                if existingRoot != nil {
                    Toggle("Enabled", isOn: $enabled)
                }
            }
            .formStyle(.grouped)

            Divider()

            HStack {
                Spacer()
                Button("Cancel") {
                    dismiss()
                }
                Button(existingRoot == nil ? "Add Root" : "Save Changes") {
                    save()
                }
                .buttonStyle(.borderedProminent)
                .disabled(canSave == false)
            }
            .padding(20)
        }
        .frame(width: 520, height: 420)
    }

    private func save() {
        guard let parsedMaxFileSize else { return }
        if let existingRoot {
            onUpdate(existingRoot.id, FileRootUpdateInput(
                label: label.trimmingCharacters(in: .whitespacesAndNewlines),
                permission: permission,
                filePatterns: splitPatterns(filePatterns),
                excludePatterns: splitPatterns(excludePatterns),
                maxFileSizeBytes: parsedMaxFileSize,
                enabled: enabled
            ))
        } else {
            onCreate(FileRootRegistrationInput(
                workspaceId: workspaceID,
                label: label.trimmingCharacters(in: .whitespacesAndNewlines),
                rootPath: rootPath.trimmingCharacters(in: .whitespacesAndNewlines),
                permission: permission,
                filePatterns: splitPatterns(filePatterns),
                excludePatterns: splitPatterns(excludePatterns),
                maxFileSizeBytes: parsedMaxFileSize
            ))
        }
        dismiss()
    }

    private func splitPatterns(_ value: String) -> [String] {
        value
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.isEmpty == false }
    }
}
