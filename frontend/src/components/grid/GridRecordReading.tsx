/**
 * What the local store holds, and whether it can be reached at all.
 *
 * A READING, NOT A SETTINGS PANE. Which database to open is configuration and
 * lives with the interpreter in Settings; what is IN it is a question asked of
 * a result. The operational record is revised in batches -- the operator
 * rewrote fourteen months of 2025 across four days -- so "which revision is
 * this figure about" is asked while a figure is on screen, not before one
 * exists.
 *
 * UNREACHABLE IS THE PRIMARY STATE, not an error case bolted on. Three
 * different things send a reader here -- a driver that is not installed, a
 * server that is not running, a database that was never created -- and each
 * needs a different action. The sidecar already writes the sentence; this
 * renders it rather than replacing it with "failed to load".
 */
import { Chip, Stat, StatGrid, WaterFigure } from "@/components/analysisPrimitives"
import type { GridStoreReport } from "@/lib/types"

/** Thousands separated, because these are counts a reader compares by eye. */
function count(n: number): string {
  return n.toLocaleString()
}

/**
 * The connection, and what decided it.
 *
 * Naming the source is the point, and it is the same case the environment
 * screen makes for reporting TERRA_PYTHON: a variable exported in a shell
 * profile months ago keeps deciding every launch from that terminal, and a
 * selection that is being overruled has to say so rather than appear to apply.
 */
function Connection({ report }: { report: GridStoreReport }) {
  const source =
    report.dsn_source === "TERRA_BR_DSN"
      ? "set by TERRA_BR_DSN"
      : report.dsn_source === "chosen"
        ? "chosen in Settings"
        : "the sidecar's own default"
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip tone={report.reachable ? "accent" : "muted"}>
        {report.reachable ? "reachable" : "unreachable"}
      </Chip>
      <span className="telemetry min-w-0 truncate text-meta text-foreground">
        {report.dsn}
      </span>
      <span className="text-meta text-muted-foreground">{source}</span>
    </div>
  )
}

export function GridRecordReading({
  report,
}: {
  report: GridStoreReport | null
}) {
  if (!report) {
    return (
      <div className="p-3 text-meta text-muted-foreground">
        The grid store has not been checked yet.
      </div>
    )
  }

  if (!report.reachable) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <Connection report={report} />
        {/*
          The sidecar's own sentence, verbatim. It already names which of the
          three failures this is and what to do about it; paraphrasing it here
          would put a second, staler copy of that knowledge in the frontend.
        */}
        <p className="text-body leading-relaxed text-foreground">
          {report.unreachable}
        </p>
        <p className="text-meta text-muted-foreground">
          Nothing about the electrical system can be read until this is
          answered. The resource products are unaffected.
        </p>
      </div>
    )
  }

  const coverage = report.coverage
  if (!coverage || coverage.datasets.length === 0) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <Connection report={report} />
        <p className="text-body leading-relaxed text-foreground">
          The database is there and carries the schema, but no operational
          record has been loaded into it.
        </p>
      </div>
    )
  }

  const rows = coverage.datasets.reduce((sum, d) => sum + d.rows, 0)
  return (
    <div className="panel-scroll flex flex-col gap-4 overflow-y-auto p-3">
      <Connection report={report} />

      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        <WaterFigure dense label="Half-hourly rows" value={count(rows)} />
        <WaterFigure
          dense
          label="Records"
          value={String(coverage.datasets.length)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="eyebrow">Coverage</div>
        {coverage.datasets.map((d) => (
          <Stat
            key={d.dataset}
            label={d.dataset}
            value={`${count(d.rows)} rows · ${d.from}..${d.to} · ${d.periods} periods`}
          />
        ))}
        {/*
          The load time is not the publication time, and the difference is the
          reason this is stated at all. ONS rewrites whole years in a batch, so
          a store loaded before a rewrite holds a superseded revision -- and
          two runs made on different days can read different data without
          anything else on screen saying so.
        */}
        <p className="mt-1 text-meta text-muted-foreground">
          Loaded {coverage.datasets[0].loaded_utc.slice(0, 10)}. The operator
          revises published months in batches, so a record loaded before a
          revision holds the superseded one.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="eyebrow">Register</div>
        <Stat
          label="Plants"
          value={`${count(coverage.plants.registered)} · ${count(
            coverage.plants.with_geometry
          )} located`}
        />
        <Stat
          label="Network"
          value={`${count(coverage.network.substations)} substations · ${count(
            coverage.network.lines_in_service
          )} lines in service`}
        />
        {coverage.plants.with_geometry < coverage.plants.registered && (
          /*
            Stated rather than left as a gap between two numbers. The missing
            coordinates are not a failed load: ANEEL writes an absent
            coordinate as 0.0, and those enterprises are stored with no
            geometry rather than as a point off the coast of Africa. They are
            still reachable by CEG; only the spatial join cannot see them.
          */
          <p className="mt-1 text-meta text-muted-foreground">
            {count(coverage.plants.registered - coverage.plants.with_geometry)}{" "}
            plants carry no coordinate in the register, so an area search cannot
            reach them. They remain joinable by CEG.
          </p>
        )}
      </div>

      {coverage.load_conflicts.total > 0 && (
        <div className="flex flex-col gap-1">
          <div className="eyebrow">Recorded conflicts</div>
          <StatGrid at="pair">
            <Stat
              label="Instants with two rows"
              value={count(coverage.load_conflicts.total)}
            />
            <Stat
              label="Of those, identical"
              value={count(coverage.load_conflicts.identical)}
            />
          </StatGrid>
          <p className="mt-1 text-meta text-muted-foreground">
            {coverage.load_conflicts.note ??
              "The first row of each colliding set was kept, and every choice is recorded."}
          </p>
        </div>
      )}
    </div>
  )
}
