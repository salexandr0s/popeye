import SwiftUI

struct BrainSidebarView: View {
    @Binding var selection: BrainPane?

    var body: some View {
        List(BrainPane.allCases, selection: $selection) { pane in
            Label(pane.title, systemImage: pane.systemImage)
                .tag(pane)
        }
        .listStyle(.sidebar)
    }
}
