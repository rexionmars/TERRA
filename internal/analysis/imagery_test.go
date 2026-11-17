package analysis

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
)

func TestNothingChosenReadsThePlanetaryComputer(t *testing.T) {
	for _, c := range ImageryCollections {
		t.Setenv(c.Env, "")
		key, fromEnv := EffectiveImagerySource(c, nil)
		if key != DefaultImagerySource || fromEnv {
			t.Fatalf("%s with nothing chosen reads %q (from env %v)", c.Collection, key, fromEnv)
		}
	}
	if env := ImageryEnv(nil); len(env) != 0 {
		t.Fatalf("nothing chosen still sent %v", env)
	}
}

func TestTheChoiceTravelsAsTheVariableTheSidecarReads(t *testing.T) {
	t.Setenv("TERRA_SENTINEL2_SOURCE", "")
	t.Setenv("TERRA_SENTINEL1_SOURCE", "")
	env := ImageryEnv(map[string]string{"sentinel-2-l2a": "earth-search", "sentinel-1-rtc": "opera"})
	want := []string{"TERRA_SENTINEL2_SOURCE=earth-search", "TERRA_SENTINEL1_SOURCE=opera"}
	if !slices.Equal(env, want) {
		t.Fatalf("env = %v, want %v", env, want)
	}
}

// A variable exported in the shell wins over the setting, and is not repeated:
// a later duplicate in cmd.Env would replace the inherited value.
func TestAVariableAlreadySetWinsAndIsNotRepeated(t *testing.T) {
	t.Setenv("TERRA_SENTINEL2_SOURCE", "planetary-computer")
	t.Setenv("TERRA_SENTINEL1_SOURCE", "")
	chosen := map[string]string{"sentinel-2-l2a": "earth-search"}

	if env := ImageryEnv(chosen); len(env) != 0 {
		t.Fatalf("env = %v; the inherited variable must be left to apply", env)
	}
	c, _ := ImageryCollectionNamed("sentinel-2-l2a")
	key, fromEnv := EffectiveImagerySource(c, chosen)
	if key != "planetary-computer" || !fromEnv {
		t.Fatalf("effective source = %q (from env %v)", key, fromEnv)
	}
}

// The runner asks for its variables at each start, so a source chosen while
// the application runs reaches the next run without rebuilding the runner.
func TestEverySidecarRunCarriesTheEnvironmentAsItStandsAtThatStart(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the stand-in sidecar is a POSIX shell script")
	}
	script := filepath.Join(t.TempDir(), "sidecar.sh")
	body := "#!/bin/sh\ncat >/dev/null\nprintf '{\"source\":\"%s\"}' \"$TERRA_SENTINEL2_SOURCE\"\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TERRA_SENTINEL2_SOURCE", "")
	r := &Runner{pythonPath: "/bin/sh", sidecar: script}
	chosen := "earth-search"
	r.SetEnvironment(func() []string { return []string{"TERRA_SENTINEL2_SOURCE=" + chosen} })

	first, err := r.runSidecarJSON(context.Background(), []byte("{}"))
	if err != nil {
		t.Fatal(err)
	}
	chosen = "planetary-computer"
	second, err := r.runSidecarJSON(context.Background(), []byte("{}"))
	if err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(first, `"earth-search"`) || !strings.Contains(second, `"planetary-computer"`) {
		t.Fatalf("the runs read %s then %s", first, second)
	}
}
