import XCTest
@testable import CRAMMobile

final class ServerConfigurationTests: XCTestCase {
    func testNormalizesTrailingSlashesAndCase() throws {
        let configuration = try ServerConfiguration(
            rawValue: "  HTTPS://CRM.Example.com/base///  "
        )

        XCTAssertEqual(
            configuration.serverURL.absoluteString,
            "https://crm.example.com/base"
        )
    }

    func testRejectsRemotePlainHTTP() {
        XCTAssertThrowsError(
            try ServerConfiguration(rawValue: "http://crm.example.com")
        )
    }

    func testAllowsLoopbackHTTPForSimulatorDevelopment() throws {
        let configuration = try ServerConfiguration(
            rawValue: "http://localhost:3200/"
        )

        XCTAssertEqual(
            configuration.serverURL.absoluteString,
            "http://localhost:3200"
        )
    }

    func testRejectsCredentialsQueryAndFragment() {
        XCTAssertThrowsError(
            try ServerConfiguration(rawValue: "https://user:pass@crm.example.com")
        )
        XCTAssertThrowsError(
            try ServerConfiguration(rawValue: "https://crm.example.com?token=secret")
        )
        XCTAssertThrowsError(
            try ServerConfiguration(rawValue: "https://crm.example.com/#settings")
        )
    }
}
