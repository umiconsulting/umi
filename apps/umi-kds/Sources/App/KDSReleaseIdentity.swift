import Foundation

struct KDSReleaseIdentity: Sendable {
    let environment: String
    let version: String
    let gitCommit: String
    let buildTimestamp: String
    let contractVersion: String

    static func load(bundle: Bundle = .main) -> KDSReleaseIdentity {
        func value(_ key: String, fallback: String = "unavailable") -> String {
            guard let raw = bundle.object(forInfoDictionaryKey: key) as? String else { return fallback }
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty || trimmed.contains("$(") ? fallback : trimmed
        }

        return KDSReleaseIdentity(
            environment: value("KDSEnvironment", fallback: "invalid"),
            version: value("KDSReleaseVersion"),
            gitCommit: value("KDSReleaseGitCommit"),
            buildTimestamp: value("KDSReleaseBuildTimestamp"),
            contractVersion: value("KDSContractVersion")
        )
    }
}
