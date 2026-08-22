/*
Package store is the local SQLite database and the files that belong beside it.

One user, one machine, one file. There is no server and no sync, so the things
a hosted store spends its design on -- tenancy, pooling for concurrent load,
migrations coordinated across deployments -- are not what this package is
about. What it is about is that the data is the only copy: a researcher's runs,
projects, saved boards and the PNG and GeoTIFF assets each run produced.

That single-copy property is why the destructive paths here are written the way
they are. Backup snapshots the database with VACUUM INTO rather than copying a
file that may be mid-write. Restore unpacks into a staging directory, verifies
the result is one of ours, and only then renames the old directory aside --
never over it. The schema carries a version in PRAGMA user_version and each
migration step inspects the table before altering it, so a database written by
an older build is reconciled rather than replayed against.

Assets live under the data directory in per-run and per-project folders, and
the row is the record: a file with no row is reclaimable, which is what
PurgeOrphanedRunAssets is for. Foreign keys are not enforced on this
connection, so the ON DELETE CASCADE clauses in the schema are documentation of
intent rather than a mechanism; deletion is done explicitly, in the method that
owns it.
*/
package store
