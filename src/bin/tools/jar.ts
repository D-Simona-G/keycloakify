import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { relative, sep } from "path";
import { createWriteStream } from "fs";

import walk from "./walk";
import type { ZipSource } from "./zip";
import zip from "./zip";

/** Trim leading whitespace from every line */
const trimIndent = (s: string) => s.replace(/(\n)\s+/g, "$1");

type JarArgs = {
    rootPath: string;
    targetPath: string;
    groupId: string;
    artifactId: string;
    version: string;
};

/**
 * Create a jar archive, using the resources found at `rootPath` (a directory) and write the
 * archive to `targetPath` (a file). Use `groupId`, `artifactId` and `version` to define
 * the contents of the pom.properties file which is going to be added to the archive.
 */
export default async function jar({ groupId, artifactId, version, rootPath, targetPath }: JarArgs) {
    const manifest: ZipSource = {
        path: "META-INF/MANIFEST.MF",
        data: Buffer.from(
            trimIndent(
                `Manifest-Version: 1.0
                 Archiver-Version: Plexus Archiver
                 Created-By: Keycloakify
                 Built-By: unknown
                 Build-Jdk: 19.0.0`
            )
        )
    };

    const pomProps: ZipSource = {
        path: `META-INF/maven/${groupId}/${artifactId}/pom.properties`,
        data: Buffer.from(
            trimIndent(
                `# Generated by keycloakify
                 # ${new Date()}
                 artifactId=${artifactId}
                 groupId=${groupId}
                 version=${version}`
            )
        )
    };

    /**
     * Convert every path entry to a ZipSource record, and when all records are
     * processed, append records for MANIFEST.mf and pom.properties
     */
    const pathToRecord = () =>
        new Transform({
            objectMode: true,
            transform: function (path, _, cb) {
                const filename = relative(rootPath, path).split(sep).join("/");
                this.push({ filename, path });
                cb();
            },
            final: function () {
                this.push(manifest);
                this.push(pomProps);
                this.push(null);
            }
        });

    /**
     * Create an async pipeline, wait until everything is fully processed
     */
    await pipeline(
        // walk all files in `rootPath` recursively
        Readable.from(walk(rootPath)),
        // transform every path into a ZipSource object
        pathToRecord(),
        // let the zip lib convert all ZipSource objects into a byte stream
        zip(),
        // write that byte stream to targetPath
        createWriteStream(targetPath, { encoding: "binary" })
    );
}

/**
 * Standalone usage, call e.g. `ts-node jar.ts dirWithSources some-jar.jar`
 */
if (require.main === module) {
    const main = () =>
        jar({
            rootPath: process.argv[2],
            targetPath: process.argv[3],
            artifactId: process.env.ARTIFACT_ID ?? "artifact",
            groupId: process.env.GROUP_ID ?? "group",
            version: process.env.VERSION ?? "1.0.0"
        });
    main().catch(e => console.error(e));
}