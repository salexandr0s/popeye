import AppKit
import SwiftUI
import Testing
@testable import PopeyeMac

@MainActor
@Suite("SwiftUI Render Smoke")
struct SwiftUIRenderSmokeTests {
    @Test("Settings view renders with preview state")
    func rendersSettingsView() {
        let appModel = FeaturePreviewFixtures.previewAppModel()
        appModel.connectionState = .connected
        appModel.sseConnected = true

        assertRenders(
            SettingsView(
                diagnosticsResult: DiagnosticsResult(healthy: true, latencyMs: 42, error: nil)
            )
            .environment(appModel)
        )
    }

    @Test("Control changes section renders with fixture data")
    func rendersControlChangesSection() {
        assertRenders(
            ControlChangesSection(receipts: FeaturePreviewFixtures.homeSummary.controlChanges)
        )
    }

    @Test("Dashboard view renders with populated preview state")
    func rendersDashboardView() {
        assertRenders(
            NavigationStack {
                DashboardView(store: .previewPopulated())
            }
        )
    }

    @Test("Usage & Security view renders with governance data")
    func rendersUsageSecurityView() async {
        let store = UsageSecurityStore(dependencies: .stub())
        await store.load()

        assertRenders(
            NavigationStack {
                UsageSecurityView(store: store)
            }
        )
    }

    private func assertRenders<Content: View>(_ view: Content) {
        let hostingView = NSHostingView(rootView: view)
        hostingView.frame = NSRect(x: 0, y: 0, width: 900, height: 700)
        hostingView.layoutSubtreeIfNeeded()
        hostingView.displayIfNeeded()

        let imageRep = hostingView.bitmapImageRepForCachingDisplay(in: hostingView.bounds)
        #expect(imageRep != nil)

        withExtendedLifetime(hostingView) {}
    }
}
