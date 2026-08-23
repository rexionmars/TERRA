/**
 * Fails when frontend/src/lib/types.ts stops describing the same JSON as
 * internal/analysis/types*.go.
 *
 * The TypeScript file says in its own header that it mirrors the Go structs by
 * hand. The Wails bridge does generate wailsjs/go/models.ts, but almost nothing
 * imports it, so the hand-written file is what the frontend believes -- and a
 * field renamed in Go compiles clean on the TypeScript side. This repository
 * has already shipped a hand-copied palette and a hand-copied set of table
 * columns that drifted while nothing compared them; this is the same shape of
 * copy, with the same failure available to it.
 *
 * What is compared: for every Go struct in internal/analysis/types*.go that has a
 * same-named exported interface in types.ts, the SET OF JSON FIELD NAMES. The
 * Go names come from the `json:"..."` struct tags (`,omitempty` stripped, a tag
 * of `-` dropped, an empty name falling back to the Go field name as
 * encoding/json does). The TypeScript names come from the interface members,
 * read with the TypeScript compiler API rather than a regular expression.
 *
 * What is NOT compared, and therefore can still drift unnoticed:
 *   - field TYPES: `number` against `string`, `[][]float64` against
 *     `number[][][]`, an enum narrowed to a union -- none of it is looked at;
 *   - OPTIONALITY: `?` on the TypeScript side is never checked against
 *     `omitempty` on the Go side, in either direction;
 *   - NESTING: a field is a name here, so a renamed field of a struct that has
 *     no interface of its own is invisible;
 *   - structs with NO same-named interface, which are counted and reported so
 *     the run states how much of the surface is actually guarded;
 *   - Go types declared outside internal/analysis/types*.go, and TypeScript types that are
 *     not `interface` declarations (unions, aliases).
 *
 * Deliberate divergences are named one by one in EXEMPT below, with the reason,
 * rather than paid for by loosening the comparison. An exemption that has
 * stopped describing the code fails too, so the list cannot rot into a hole.
 *
 * Run with:
 *
 *   cd frontend && npx tsx scripts/check-types.ts
 */
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import ts from "typescript"

const here = dirname(fileURLToPath(import.meta.url))
/**
 * Every file the analysis package declares its wire types in.
 *
 * Listed rather than globbed, and the check fails when one is missing: a glob
 * would silently stop guarding a struct whose file was renamed, which is the
 * same shape of quiet failure this whole script exists to catch. types.go was
 * split by product, so a new products file has to be added here to be guarded.
 */
const GO_DIR = join(here, "..", "..", "internal", "analysis")
const GO_FILES = [
  "types.go",
  "types_energy.go",
  "types_wind.go",
  "types_canopy.go",
  "types_flood.go",
]
const TS = join(here, "..", "src", "lib", "types.ts")

/**
 * Divergences that are meant.
 *
 * Recorded per interface and per field, with the reason, so that a deliberate
 * difference does not have to be bought by loosening the comparison for
 * everything else. `goOnly` is a field the Go struct carries and the frontend
 * has no use for; `tsOnly` is a field the frontend adds to a decoded value.
 */
type Exemption = { goOnly?: Record<string, string>; tsOnly?: Record<string, string> }
const EXEMPT: Record<string, Exemption> = {
  LULCAnalysis: {
    goOnly: {
      // A filesystem path to the map the sidecar wrote, and one the frontend
      // could not open in any case. Nothing on the response path ever assigns
      // it -- backend/sidecar.go reads the sidecar's own map_png and turns it
      // into the map_uri data URI -- and app.go blanks it again before a run is
      // stored, so with `omitempty` the field never reaches the wire.
      map_png: "server-side path, never populated on the response",
    },
  },
}

/** Field names carried by one Go struct, in declaration order. */
type GoStruct = { name: string; line: number; fields: string[] }

/**
 * The structs declared in internal/analysis/types*.go.
 *
 * Hand-written rather than delegated to a Go parser, because the file is a flat
 * list of tagged structs: no embedded types, no inline struct literals, no
 * aliases. That regularity is an assumption, so every line inside a struct that
 * this cannot classify raises instead of being skipped -- a guard that quietly
 * ignores the fields it does not understand reports a clean run over a shape it
 * never read.
 */
function goStructs(): GoStruct[] {
  const lines = GO_FILES.flatMap((name) => {
    const path = join(GO_DIR, name)
    if (!existsSync(path)) {
      throw new Error(
        `${path} is listed in GO_FILES and is not there. Either it was renamed, ` +
          `in which case the structs in it are no longer guarded, or the list is stale.`
      )
    }
    return readFileSync(path, "utf8").split("\n")
  })
  const out: GoStruct[] = []
  let current: GoStruct | null = null

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const at = i + 1
    const open = raw.match(/^type ([A-Za-z_][A-Za-z0-9_]*) struct \{\s*$/)
    if (open) {
      current = { name: open[1], line: at, fields: [] }
      continue
    }
    if (!current) continue
    if (raw === "}") {
      out.push(current)
      current = null
      continue
    }

    const line = raw.trim()
    if (line === "" || line.startsWith("//")) continue

    const tag = line.match(/`([^`]*)`/)
    if (!tag) {
      throw new Error(
        `${GO_DIR}:${at}: cannot read a JSON name from "${line}" in struct ` +
          `${current.name}. An embedded type, an inline struct literal or an ` +
          `untagged field needs this parser extended, not a silent skip.`
      )
    }
    const json = tag[1].match(/json:"([^"]*)"/)
    // A tagged field with no json: key is not serialised under a chosen name.
    if (!json) continue

    const [named] = json[1].split(",")
    if (named === "-") continue

    // `json:",omitempty"` leaves the name to encoding/json, which uses the Go
    // field name verbatim.
    if (named === "") {
      const field = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s/)
      if (!field) {
        throw new Error(`${GO_DIR}:${at}: empty json name and no field name in "${line}"`)
      }
      current.fields.push(field[1])
      continue
    }
    current.fields.push(named)
  }

  if (current) throw new Error(`${GO_DIR}: struct ${current.name} is never closed`)
  return out
}

/**
 * The exported interfaces in types.ts, read through the compiler rather than by
 * pattern: a property split over lines, or a comment holding something that
 * looks like a field, is a parsing problem the compiler already solved.
 */
function tsInterfaces(): Map<string, string[]> {
  const text = readFileSync(TS, "utf8")
  const source = ts.createSourceFile(TS, text, ts.ScriptTarget.ES2022, true)
  const out = new Map<string, string[]>()

  for (const statement of source.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue
    const fields: string[] = []
    for (const member of statement.members) {
      if (!ts.isPropertySignature(member) || !member.name) {
        // Index signatures and call signatures carry no field name to compare;
        // an interface holding one is reported so it is not read as guarded.
        const { line } = source.getLineAndCharacterOfPosition(member.getStart(source))
        console.warn(
          `note   ${statement.name.text} has a member at ${TS}:${line + 1} that ` +
            `is not a named property; it is not compared`
        )
        continue
      }
      fields.push(
        ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
          ? member.name.text
          : member.name.getText(source)
      )
    }
    out.set(statement.name.text, fields)
  }
  return out
}

const structs = goStructs()
const interfaces = tsInterfaces()

let failed = 0
let compared = 0
const unmatched: string[] = []

for (const struct of structs) {
  const iface = interfaces.get(struct.name)
  if (!iface) {
    unmatched.push(struct.name)
    continue
  }
  compared++

  const exempt = EXEMPT[struct.name] ?? {}
  const goSet = new Set(struct.fields)
  const tsSet = new Set(iface)

  for (const field of struct.fields) {
    if (tsSet.has(field) || exempt.goOnly?.[field]) continue
    console.error(
      `DRIFT  ${struct.name}.${field}: in internal/analysis/types*.go (line ${struct.line}), ` +
        `missing from types.ts`
    )
    failed++
  }
  for (const field of iface) {
    if (goSet.has(field) || exempt.tsOnly?.[field]) continue
    console.error(
      `DRIFT  ${struct.name}.${field}: in types.ts, missing from ` +
        `internal/analysis/types*.go (struct at line ${struct.line})`
    )
    failed++
  }
}

/*
  The exemptions themselves, checked against what is actually there.

  An exemption is a hole in the comparison, and a hole nobody revisits is how
  this failure returns: a field added to types.ts under a name still listed as
  Go-only would be waved through forever. So each one has to still be doing the
  work it claims -- the struct compared, the field on exactly the side the
  exemption puts it on -- or it is a failure in its own right and gets deleted.
*/
for (const [name, exempt] of Object.entries(EXEMPT)) {
  const struct = structs.find((s) => s.name === name)
  const iface = interfaces.get(name)
  if (!struct || !iface) {
    console.error(
      `STALE  exemption for ${name}, which is not a compared struct any more`
    )
    failed++
    continue
  }
  for (const [field, reason] of Object.entries(exempt.goOnly ?? {})) {
    if (!struct.fields.includes(field)) {
      console.error(
        `STALE  exemption ${name}.${field} ("${reason}"): gone from internal/analysis/types*.go`
      )
      failed++
    } else if (iface.includes(field)) {
      console.error(
        `STALE  exemption ${name}.${field} ("${reason}"): types.ts carries it now`
      )
      failed++
    }
  }
  for (const [field, reason] of Object.entries(exempt.tsOnly ?? {})) {
    if (!iface.includes(field)) {
      console.error(
        `STALE  exemption ${name}.${field} ("${reason}"): gone from types.ts`
      )
      failed++
    } else if (struct.fields.includes(field)) {
      console.error(
        `STALE  exemption ${name}.${field} ("${reason}"): internal/analysis/types*.go carries it now`
      )
      failed++
    }
  }
}

const goNames = new Set(structs.map((s) => s.name))
const tsOnlyInterfaces = [...interfaces.keys()].filter((n) => !goNames.has(n))

console.log(
  `\n${structs.length} struct(s) in internal/analysis/types*.go, ` +
    `${interfaces.size} interface(s) in types.ts.`
)
console.log(`  ${compared} compared by field name.`)
console.log(
  `  ${unmatched.length} Go struct(s) with no same-named interface, so not guarded.`
)
console.log(
  `  ${tsOnlyInterfaces.length} interface(s) with no same-named Go struct ` +
    `(frontend-only shapes, or shapes named differently).`
)

if (failed) {
  console.error(`\n${failed} problem(s).`)
  process.exit(1)
}
console.log("\nEvery mirrored struct carries the same JSON field names on both sides.")
