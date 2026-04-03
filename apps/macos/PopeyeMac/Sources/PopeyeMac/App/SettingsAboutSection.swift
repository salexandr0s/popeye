import SwiftUI

struct SettingsAboutSection: View {
    let shortVersion: String
    let buildNumber: String

    var body: some View {
        Section("About") {
            LabeledContent("App", value: "PopeyeMac")
            LabeledContent("Version", value: shortVersion)
            LabeledContent("Build", value: buildNumber)
        }
    }
}
