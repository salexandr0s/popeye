import SwiftUI
import PopeyeAPI

struct AppShellView: View {
    @Environment(AppModel.self) private var appModel

    var body: some View {
        @Bindable var navigation = appModel.navigation
        NavigationSplitView {
            AppSidebar(selection: $navigation.selectedRoute)
        } detail: {
            detailContent
        }
        .toolbar {
            AppToolbar()
        }
    }

    @ViewBuilder
    private var detailContent: some View {
        if appModel.client != nil {
            AppRouteDestinationView(route: appModel.selectedRoute ?? .home)
        } else {
            PlaceholderView(route: appModel.selectedRoute ?? .home)
        }
    }
}

#Preview {
    AppShellView()
        .environment(AppModel())
}
