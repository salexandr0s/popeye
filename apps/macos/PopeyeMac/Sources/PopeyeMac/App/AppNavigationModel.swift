import Foundation
import Observation

@Observable @MainActor
final class AppNavigationModel {
    @ObservationIgnored
    private let storage: UserDefaults

    var selectedRoute: AppRoute? {
        didSet {
            guard oldValue != selectedRoute else { return }
            storage.set(selectedRoute?.rawValue, forKey: StorageKey.selectedRoute)
        }
    }

    init(storage: UserDefaults = .standard) {
        self.storage = storage
        if let raw = storage.string(forKey: StorageKey.selectedRoute),
           let route = AppRoute(rawValue: raw) {
            selectedRoute = route
        } else {
            selectedRoute = .home
        }
    }

    func navigate(to route: AppRoute) {
        selectedRoute = route
    }
}

private enum StorageKey {
    static let selectedRoute = "selectedRoute"
}
