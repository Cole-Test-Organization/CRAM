import Foundation

struct ServerConfiguration: Equatable, Sendable {
    static let defaultServerURL = URL(string: "https://crm.home.justcole.com")!

    let serverURL: URL

    init(serverURL: URL) throws {
        self.serverURL = try Self.normalize(serverURL.absoluteString)
    }

    init(rawValue: String) throws {
        self.serverURL = try Self.normalize(rawValue)
    }

    private static func normalize(_ rawValue: String) throws -> URL {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, var components = URLComponents(string: trimmed) else {
            throw ServerConfigurationError.invalidURL
        }

        let scheme = components.scheme?.lowercased()
        let host = components.host?.lowercased()
        guard let scheme, let host, !host.isEmpty, scheme == "https" || scheme == "http" else {
            throw ServerConfigurationError.invalidURL
        }
        if scheme == "http" && !["localhost", "127.0.0.1", "::1"].contains(host) {
            throw ServerConfigurationError.insecureRemoteURL
        }
        guard components.user == nil, components.password == nil else {
            throw ServerConfigurationError.credentialsNotAllowed
        }
        guard components.query == nil, components.fragment == nil else {
            throw ServerConfigurationError.queryOrFragmentNotAllowed
        }

        components.scheme = scheme
        components.host = host
        var path = components.percentEncodedPath
        while path.count > 1 && path.hasSuffix("/") {
            path.removeLast()
        }
        components.percentEncodedPath = path == "/" ? "" : path

        guard let normalized = components.url else {
            throw ServerConfigurationError.invalidURL
        }
        return normalized
    }
}

enum ServerConfigurationError: LocalizedError {
    case credentialsNotAllowed
    case insecureRemoteURL
    case invalidURL
    case queryOrFragmentNotAllowed

    var errorDescription: String? {
        switch self {
        case .credentialsNotAllowed:
            return "The CRAM server URL cannot contain a username or password."
        case .insecureRemoteURL:
            return "Remote CRAM servers must use HTTPS. HTTP is allowed only for local development."
        case .invalidURL:
            return "Enter a complete CRAM server URL using https://."
        case .queryOrFragmentNotAllowed:
            return "The CRAM server URL cannot contain a query string or fragment."
        }
    }
}

final class ServerConfigurationStore {
    private let defaults: UserDefaults
    private let key = "cram.mobile.server-url.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> ServerConfiguration {
        guard
            let stored = defaults.string(forKey: key),
            let configuration = try? ServerConfiguration(rawValue: stored)
        else {
            return try! ServerConfiguration(serverURL: ServerConfiguration.defaultServerURL)
        }
        return configuration
    }

    func save(_ configuration: ServerConfiguration) {
        defaults.set(configuration.serverURL.absoluteString, forKey: key)
    }
}
