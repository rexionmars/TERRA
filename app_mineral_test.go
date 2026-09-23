package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"geosense-infer/internal/analysis"
	"geosense-infer/internal/pyenv"
)

// The token reaches the LP DAAC as a bearer header, and a refusal says which
// of its two causes to check rather than reporting a bare status code.
func TestVerifyEarthdataTokenSendsBearerAndNamesTheRefusal(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("Authorization")
		if got != "Bearer good" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte("<Dataset/>"))
	}))
	defer srv.Close()

	if err := verifyEarthdataToken(context.Background(), srv.Client(), srv.URL, "good"); err != nil {
		t.Fatalf("accepted token reported as refused: %v", err)
	}
	if got != "Bearer good" {
		t.Fatalf("Authorization = %q", got)
	}
	err := verifyEarthdataToken(context.Background(), srv.Client(), srv.URL, "bad")
	if err == nil {
		t.Fatal("a refused token was accepted")
	}
	for _, want := range []string{"401", "expired", "data use terms"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("refusal %q does not mention %q", err, want)
		}
	}
}

// The variable wins over the saved token, and wins by the Go side sending
// nothing: runSidecarJSONEnv appends after os.Environ, so sending the saved
// token would replace the variable the sidecar inherits.
func TestEarthdataTokenPrecedence(t *testing.T) {
	cfg := pyenv.AppConfig{EarthdataToken: " saved "}

	t.Setenv(analysis.EarthdataTokenEnv, "")
	if got := earthdataToken(cfg); got != "saved" {
		t.Fatalf("token = %q, want the saved one trimmed", got)
	}
	if s := earthdataStatus(cfg); !s.Configured || s.Source != "chosen" {
		t.Fatalf("status = %+v", s)
	}

	t.Setenv(analysis.EarthdataTokenEnv, "from-shell")
	if got := earthdataToken(cfg); got != "" {
		t.Fatalf("token = %q, want empty so the inherited variable applies", got)
	}
	if s := earthdataStatus(cfg); s.Source != analysis.EarthdataTokenEnv {
		t.Fatalf("status = %+v", s)
	}

	t.Setenv(analysis.EarthdataTokenEnv, "")
	if s := earthdataStatus(pyenv.AppConfig{}); s.Configured || s.Source != "none" {
		t.Fatalf("status = %+v", s)
	}
}
