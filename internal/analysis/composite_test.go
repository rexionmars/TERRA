package analysis

import (
	"strings"
	"testing"
)

func TestABiomassMapNeedsNeitherASceneNorAPeriod(t *testing.T) {
	action, err := compositeAction(CompositeRequest{Kind: "biomass"})
	if err != nil || action != "biomass_map" {
		t.Fatalf("got %q, %v; want biomass_map", action, err)
	}
}

func TestAViewFromTheMedianNeedsNoScene(t *testing.T) {
	req := CompositeRequest{Kind: "pca", Median: true, Start: "2026-01-01", End: "2026-06-30"}
	action, err := compositeAction(req)
	if err != nil || action != "render_composite" {
		t.Fatalf("got %q, %v; want render_composite", action, err)
	}
}

func TestAChangeOrACanopyViewIsRefusedFromTheMedian(t *testing.T) {
	for _, kind := range []string{"change", "biophysical"} {
		req := CompositeRequest{Kind: kind, Median: true, Start: "2026-01-01", End: "2026-06-30"}
		if _, err := compositeAction(req); err == nil || !strings.Contains(err.Error(), "single scenes") {
			t.Errorf("%s from the median: got %v, want a refusal naming single scenes", kind, err)
		}
	}
}

func TestAChangeNeedsTwoDifferentScenes(t *testing.T) {
	base := CompositeRequest{Kind: "change", SceneID: "b", Start: "2026-01-01", End: "2026-06-30"}
	if _, err := compositeAction(base); err == nil || !strings.Contains(err.Error(), "earlier scene") {
		t.Errorf("no earlier scene: got %v", err)
	}
	same := base
	same.SceneIDBefore = "b"
	if _, err := compositeAction(same); err == nil || !strings.Contains(err.Error(), "two different") {
		t.Errorf("one scene twice: got %v", err)
	}
	two := base
	two.SceneIDBefore = "a"
	if action, err := compositeAction(two); err != nil || action != "render_composite" {
		t.Errorf("two scenes: got %q, %v", action, err)
	}
}

func TestAViewOfOneSceneAsksForTheSceneAndThePeriod(t *testing.T) {
	if _, err := compositeAction(CompositeRequest{Kind: "rgb", Start: "2026-01-01", End: "2026-06-30"}); err == nil {
		t.Error("no scene: want an error")
	}
	if _, err := compositeAction(CompositeRequest{Kind: "rgb", SceneID: "a"}); err == nil {
		t.Error("no period: want an error")
	}
}

// A CBERS-4A view reads the one scene chosen from INPE's list, and is refused
// without it rather than started and failed in the sidecar.
func TestACBERSViewReadsItsSceneWithItsOwnAction(t *testing.T) {
	if _, err := compositeAction(CompositeRequest{Kind: "cbers"}); err == nil || !strings.Contains(err.Error(), "CBERS-4A scene") {
		t.Errorf("no scene: got %v", err)
	}
	action, err := compositeAction(CompositeRequest{Kind: "cbers", SceneID: "CBERS4A_WPM_PCA_RGB321_20240419_210_145"})
	if err != nil || action != "cbers_view" {
		t.Errorf("got %q, %v; want cbers_view", action, err)
	}
}

// The scene list goes to INPE only when the request names CBERS-4A WPM.
func TestTheSceneListGoesToTheCatalogueTheRequestNames(t *testing.T) {
	if got := dataCubeAction(DataCubeRequest{}); got != "list_datacube" {
		t.Errorf("no collection: got %q", got)
	}
	if got := dataCubeAction(DataCubeRequest{Collection: CBERS4AWPM}); got != "cbers_scenes" {
		t.Errorf("CBERS-4A: got %q", got)
	}
}
