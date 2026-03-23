import os

public enum PopeyeLogger {
    public static let app = Logger(subsystem: "com.popeye.mac", category: "app")
    public static let auth = Logger(subsystem: "com.popeye.mac", category: "auth")
    public static let network = Logger(subsystem: "com.popeye.mac", category: "network")
    public static let events = Logger(subsystem: "com.popeye.mac", category: "events")
    public static let refresh = Logger(subsystem: "com.popeye.mac", category: "refresh")
}
