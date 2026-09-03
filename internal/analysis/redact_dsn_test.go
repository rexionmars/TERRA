package analysis

import "testing"

// A connection string can carry a password in either of two shapes, and the
// environment surface renders it on screen beside the interpreter path.
// Handling one shape and missing the other is how a secret reaches a
// screenshot, so both are pinned here.
func TestRedactDSNRemovesAPasswordFromEitherForm(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{
			"url userinfo",
			"postgresql://terra:s3cret@localhost:5432/terra_br",
			"postgresql://terra:***@localhost:5432/terra_br",
		},
		{
			"keyword form",
			"host=localhost dbname=terra_br user=terra password=s3cret",
			"host=localhost dbname=terra_br user=terra password=***",
		},
		{
			// The default, and the shape a peer-authenticated local database
			// takes. Nothing to remove, and nothing may be added.
			"peer authentication carries no secret",
			"postgresql:///terra_br",
			"postgresql:///terra_br",
		},
		{
			"a user without a password survives intact",
			"postgresql://terra@localhost/terra_br",
			"postgresql://terra@localhost/terra_br",
		},
		{
			"empty stays empty rather than becoming a redaction of nothing",
			"",
			"",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := RedactDSN(c.in); got != c.want {
				t.Fatalf("RedactDSN(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

// The point of the function, stated as its own case: whatever the shape, the
// secret must not survive.
func TestRedactDSNNeverLeavesTheSecretInTheOutput(t *testing.T) {
	for _, dsn := range []string{
		"postgresql://terra:s3cret@localhost:5432/terra_br",
		"host=localhost password=s3cret dbname=terra_br",
		"postgres://u:s3cret@db.example.org/terra_br?sslmode=require",
	} {
		if got := RedactDSN(dsn); contains(got, "s3cret") {
			t.Fatalf("RedactDSN(%q) leaked the password: %q", dsn, got)
		}
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (func() bool {
		for i := 0; i+len(needle) <= len(haystack); i++ {
			if haystack[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	})()
}
