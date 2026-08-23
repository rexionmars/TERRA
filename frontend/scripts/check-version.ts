/**
 * Fails when the four places that carry the product version stop agreeing.
 *
 * The version is written by hand in four files across three languages, and
 * nothing compiles against any of the other three. `docs/RELEASING.md` lists
 * them as steps to perform, which is the same arrangement this repository
 * already has guards for elsewhere: a hand-copied palette and a hand-copied set
 * of table columns both drifted while nothing compared them.
 *
 * It has drifted here too, and shipped. `wails.json` carried no `info` block at
 * all, so every packaged bundle took Wails' own default: v0.4.0 installed on a
 * machine reported CFBundleShortVersionString 1.0.0 to the Finder, to the
 * About panel and to any crash report. Nothing failed, because nothing looked.
 *
 * version.go IS THE AUTHORITY. It is the only one the running program reads --
 * GetAppVersion feeds the What's New gate and the backup export -- and the only
 * one a release build can override from the command line, which `docs/
 * RELEASING.md` documents as `-ldflags "-X main.AppVersion=X.Y.Z"`. The other
 * three are compared against it rather than against each other, so a
 * disagreement names one file to fix rather than a cycle to reason about.
 *
 * WHAT IS DELIBERATELY NOT CHECKED, and why each would be wrong to check:
 *
 *   splashBackground.ts `since:`  Records the release a still was ADDED in, not
 *                                 the current one. It reads 0.4.0 today only
 *                                 because there is one still and it arrived in
 *                                 0.4.0; pinning it to AppVersion would rewrite
 *                                 an accurate piece of history at every bump.
 *
 *   WHATS_NEW[1..]                Older entries, for the same reason. Only the
 *                                 first is checked -- the list is newest-first
 *                                 and its own comment says to keep it in step
 *                                 when cutting a release.
 *
 *   frontend/package.json         Pinned at 0.0.0 and never read: this frontend
 *                                 is not published to a registry and nothing
 *                                 imports it by version. Raising it would be
 *                                 a fifth number to maintain for no reader.
 *
 *   the git tag                   Not a file, and absent in a shallow CI
 *                                 checkout, so requiring it would fail for a
 *                                 reason that has nothing to do with the code.
 *                                 It is reported when present and never fatal.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { execFileSync } from "node:child_process"

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, "..", "..")

/** SemVer without a leading "v", which is the form version.go documents. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function read(rel: string): string {
  const path = join(ROOT, rel)
  try {
    return readFileSync(path, "utf8")
  } catch (e) {
    // Named rather than swallowed: a file that moved is a place the version
    // stopped being guarded, which is the failure this script exists for.
    throw new Error(`${rel} is listed here and could not be read: ${e}`)
  }
}

/** One source's claim about the version, and where in the file it made it. */
interface Claim {
  file: string
  what: string
  version: string
}

function extract(rel: string, what: string, re: RegExp): Claim {
  const text = read(rel)
  const m = re.exec(text)
  if (!m?.[1]) {
    throw new Error(
      `${rel}: could not find ${what}. Either it was renamed, in which case ` +
        `the version there is no longer guarded, or this pattern is stale.`
    )
  }
  return { file: rel, what, version: m[1].trim() }
}

// The authority. Read from the source rather than by running the binary, so
// this works without a Go toolchain and without a build.
const authority = extract(
  "version.go",
  "var AppVersion",
  /^var\s+AppVersion\s*=\s*"([^"]+)"/m
)

const claims: Claim[] = [
  extract(
    "wails.json",
    'info.productVersion (what the packaged bundle reports)',
    /"productVersion"\s*:\s*"([^"]+)"/
  ),
  extract("CITATION.cff", "version:", /^version:\s*([^\s#]+)/m),
  extract(
    "frontend/src/lib/whatsNew.ts",
    "the newest WHATS_NEW entry",
    /WHATS_NEW[\s\S]*?version:\s*"([^"]+)"/
  ),
]

let failed = 0

if (!SEMVER.test(authority.version)) {
  console.error(
    `MALFORMED  ${authority.file} ${authority.what} is "${authority.version}", ` +
      `which is not SemVer without a "v" prefix.`
  )
  failed++
}

const width = Math.max(...[authority, ...claims].map((c) => c.file.length))
console.log(`\nauthority  ${authority.file.padEnd(width)}  ${authority.version}`)

for (const c of claims) {
  const agrees = c.version === authority.version
  console.log(
    `  ${agrees ? "ok  " : "DRIFT"} ${c.file.padEnd(width)}  ${c.version}  (${c.what})`
  )
  if (!agrees) failed++
}

/*
  Reported, never fatal. A tag that does not match is usually a release in
  progress rather than a mistake -- the version is bumped in a commit and the
  tag is cut afterwards -- so this is information for a reader, and CI would
  otherwise fail every pull request between the two.
*/
try {
  const tag = execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim()
  const bare = tag.replace(/^v/, "")
  console.log(
    bare === authority.version
      ? `  note  latest git tag ${tag} matches`
      : `  note  latest git tag is ${tag}, which is not ${authority.version} ` +
          `(expected while a release is being prepared)`
  )
} catch {
  console.log("  note  no git tag reachable from here; not checked")
}

if (failed) {
  console.error(
    `\n${failed} place(s) disagree with ${authority.file}. That file is the ` +
      `authority: change the others to match it, not the other way round.`
  )
  process.exit(1)
}
console.log(`\nEvery place carrying the version says ${authority.version}.`)
