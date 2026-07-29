import Foundation
import WebKit

@MainActor
final class ClientSession {
    let id = UUID()
    let configuration: ServerConfiguration
    let cache: FileResponseCache
    let schemeHandler: AppSchemeHandler
    let websiteDataStore: WKWebsiteDataStore

    init(
        configuration: ServerConfiguration,
        applicationSupportRoot: URL,
        resourceRoot: URL,
        network: any NetworkLoading = URLSessionNetworkLoader()
    ) {
        self.configuration = configuration
        let endpointKey = EndpointIdentity.storageKey(for: configuration.serverURL)
        let cacheDirectory = applicationSupportRoot
            .appendingPathComponent("CRAM Mobile", isDirectory: true)
            .appendingPathComponent(endpointKey, isDirectory: true)
            .appendingPathComponent("api-cache-v1", isDirectory: true)
        let cache = FileResponseCache(directory: cacheDirectory)
        let transport = OfflineAPITransport(
            serverURL: configuration.serverURL,
            cache: cache,
            network: network
        )
        self.cache = cache
        self.schemeHandler = AppSchemeHandler(
            resourceRoot: resourceRoot,
            transport: transport
        )
        self.websiteDataStore = WKWebsiteDataStore(
            forIdentifier: EndpointIdentity.websiteDataStoreIdentifier(
                for: configuration.serverURL
            )
        )
    }
}
