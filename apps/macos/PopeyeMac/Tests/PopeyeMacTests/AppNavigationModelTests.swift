import Foundation
import Testing
@testable import PopeyeMac

@MainActor
@Suite("App Navigation Model")
struct AppNavigationModelTests {
    @Test("Persists the selected route")
    func persistsSelectedRoute() {
        let storage = testDefaults()
        let navigation = AppNavigationModel(storage: storage)

        navigation.navigate(to: .memory)

        #expect(storage.string(forKey: "selectedRoute") == "memory")
    }

    @Test("Restores the previously selected route")
    func restoresSelectedRoute() {
        let storage = testDefaults()
        storage.set("usageSecurity", forKey: "selectedRoute")

        let navigation = AppNavigationModel(storage: storage)

        #expect(navigation.selectedRoute == .usageSecurity)
    }

    private func testDefaults() -> UserDefaults {
        let suiteName = "popeye.tests.navigation.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return defaults
    }
}
