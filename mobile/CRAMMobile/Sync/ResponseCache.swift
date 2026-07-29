import CryptoKit
import Foundation

struct CachedHTTPResponse: Equatable, Sendable {
    let statusCode: Int
    let statusText: String
    let headers: [String: String]
    let body: Data
}

protocol ResponseCaching: Sendable {
    func put(_ response: CachedHTTPResponse, for key: String) async throws
    func value(for key: String) async throws -> CachedHTTPResponse?
    func keys() async throws -> [String]
    func delete(_ key: String) async throws
    func prune(keeping keys: Set<String>) async throws
}

actor FileResponseCache: ResponseCaching {
    private struct Record: Codable {
        let version: Int
        let key: String
        let statusCode: Int
        let statusText: String
        let headers: [String: String]
        let body: Data
        let storedAt: Date
    }

    private let directory: URL
    private let fileManager: FileManager
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(directory: URL, fileManager: FileManager = .default) {
        self.directory = directory
        self.fileManager = fileManager
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    func put(_ response: CachedHTTPResponse, for key: String) throws {
        try ensureDirectory()
        let record = Record(
            version: 1,
            key: key,
            statusCode: response.statusCode,
            statusText: response.statusText,
            headers: response.headers,
            body: response.body,
            storedAt: Date()
        )
        let data = try encoder.encode(record)
        try data.write(
            to: fileURL(for: key),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
    }

    func value(for key: String) throws -> CachedHTTPResponse? {
        let url = fileURL(for: key)
        guard fileManager.fileExists(atPath: url.path) else {
            return nil
        }
        do {
            let record = try decoder.decode(Record.self, from: Data(contentsOf: url))
            guard record.version == 1, record.key == key else {
                try? fileManager.removeItem(at: url)
                return nil
            }
            return CachedHTTPResponse(
                statusCode: record.statusCode,
                statusText: record.statusText,
                headers: record.headers,
                body: record.body
            )
        } catch {
            try? fileManager.removeItem(at: url)
            return nil
        }
    }

    func keys() throws -> [String] {
        guard fileManager.fileExists(atPath: directory.path) else {
            return []
        }
        return try fileManager
            .contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .compactMap { url in
                guard
                    let data = try? Data(contentsOf: url),
                    let record = try? decoder.decode(Record.self, from: data),
                    record.version == 1
                else {
                    try? fileManager.removeItem(at: url)
                    return nil
                }
                return record.key
            }
    }

    func delete(_ key: String) throws {
        let url = fileURL(for: key)
        if fileManager.fileExists(atPath: url.path) {
            try fileManager.removeItem(at: url)
        }
    }

    func prune(keeping keys: Set<String>) throws {
        for key in try self.keys() where !keys.contains(key) {
            try delete(key)
        }
    }

    private func ensureDirectory() throws {
        try fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
    }

    private func fileURL(for key: String) -> URL {
        let digest = SHA256.hash(data: Data(key.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return directory.appendingPathComponent("\(digest).json", isDirectory: false)
    }
}
