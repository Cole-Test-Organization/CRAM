import Foundation

enum OfflineCachePolicy {
    static let cacheableResources: Set<String> = [
        "health",
        "accounts",
        "contacts",
        "meetings",
        "opportunities",
        "products",
        "product-categories",
        "vendors",
        "vendor-products",
        "events",
        "notes",
        "threads",
    ]

    static func isCacheable(_ url: URL) -> Bool {
        guard url.scheme == "cram", url.host == "app" else {
            return false
        }
        let components = url.pathComponents.filter { $0 != "/" }
        guard components.count >= 2, components[0] == "api" else {
            return false
        }
        return cacheableResources.contains(components[1])
    }
}
