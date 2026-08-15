package backend

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

/*
The Go boundary is where this payload has silently lost things.

WHAT THIS TEST IS FOR. A field the sidecar emits and no Go struct declares is
not an error anywhere: encoding/json drops it without a word, the action still
succeeds, and the surface renders whatever it can. Four separate quantities were
computed, returned, and discarded exactly this way -- the cycle segmentation, the
classification's species suggestion, the crop share, and the solar record's
provenance. Nothing failed; the reader simply never learned them.

So the fixture is a REAL payload, captured from the sidecar rather than written
by hand. A hand-written one tests that the struct decodes the struct's own idea
of the shape, which is the one thing that cannot be wrong.

Regenerate with: sidecar/infer.py < a canopy_from_aoi request, then trim the
long series -- this is about the crossings, not about volume.
*/
func TestCanopyFromAOIDecodesEveryFieldTheSidecarEmits(t *testing.T) {
	raw, err := os.ReadFile("testdata/canopy_from_aoi.json")
	if err != nil {
		t.Fatalf("reading fixture: %v", err)
	}

	var wrapped struct {
		CanopyFromAOI *CanopyFromAOI `json:"canopy_from_aoi"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	got := wrapped.CanopyFromAOI
	if got == nil {
		t.Fatal("decoded to nil")
	}

	// The four that used to be dropped.
	if len(got.Cycles) != 2 {
		t.Errorf("cycles: want 2, got %d -- the window covers two crops and "+
			"a reader who cannot see that reads one season's ages as another's",
			len(got.Cycles))
	}
	if got.Cycles[0].Greenup == "" || got.Cycles[0].End == "" {
		t.Errorf("a cycle decoded without its dates: %+v", got.Cycles[0])
	}
	if got.SpeciesSuggestion == nil || got.SpeciesSuggestion.Species != "soybean" {
		t.Errorf("species suggestion: want soybean, got %+v", got.SpeciesSuggestion)
	}
	if got.SpeciesSuggestion.Why == "" {
		t.Error("the suggestion crossed without its reason, which is the half " +
			"that lets a reader disagree with it")
	}
	if got.CropFraction == nil || *got.CropFraction <= 0 {
		t.Errorf("crop fraction: want a positive share, got %v", got.CropFraction)
	}
	if got.Sun.Provenance == nil || got.Sun.Provenance.Source == "" {
		t.Errorf("solar provenance: want fetch/cache, got %+v", got.Sun.Provenance)
	}

	// The sun's season, which decides which sky the answer is under.
	if got.Sun.WindowDays == 0 {
		t.Error("window_days decoded as zero: the answer would be captioned " +
			"with an observation date over an all-season sky")
	}
	if got.Sun.WindowCentre == "" {
		t.Error("window_centre did not cross")
	}
	if got.Sun.NHours <= 0 {
		t.Errorf("n_hours: want the size of the window, got %d", got.Sun.NHours)
	}

	// The band, and the cover that carries the geometry.
	if got.Light == nil {
		t.Fatal("light absent from a payload that has a lit date")
	}
	if got.Light.Cover <= 0 || got.Light.Cover > 1 {
		t.Errorf("cover: want a fraction, got %v", got.Light.Cover)
	}
	e := got.Light.Ensemble
	if e == nil {
		t.Fatal("ensemble absent: the surface would print three decimals of a " +
			"number whose own spread lands in the second")
	}
	if e.N < 1 || len(e.Seeds) != e.N {
		t.Errorf("ensemble n=%d but %d seeds", e.N, len(e.Seeds))
	}
	if e.FaPARMax < e.FaPARMin {
		t.Errorf("band inverted: %v to %v", e.FaPARMin, e.FaPARMax)
	}
	if got.Light.FaPAR < e.FaPARMin || got.Light.FaPAR > e.FaPARMax {
		t.Errorf("the headline faPAR %v sits outside its own band %v..%v",
			got.Light.FaPAR, e.FaPARMin, e.FaPARMax)
	}
}

// jsonTags is every JSON name the struct declares, one level deep. Pointers and
// slices are followed to their element type so a nested payload can be checked
// against the type that actually receives it.
func jsonTags(t reflect.Type) map[string]reflect.Type {
	for t.Kind() == reflect.Ptr || t.Kind() == reflect.Slice {
		t = t.Elem()
	}
	out := map[string]reflect.Type{}
	if t.Kind() != reflect.Struct {
		return out
	}
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
		if name == "" || name == "-" {
			continue
		}
		out[name] = f.Type
	}
	return out
}

/*
A field present in the JSON and absent from the struct is invisible, so the
check has to run the other way: read the emitted keys and require a declared
field for each.

BY REFLECTION AND NOT BY ROUND-TRIP, which was the first attempt and gave a
false positive within a minute: `omitempty` erases a decoded-but-zero field on
re-encode, so `row_azimuth_deg` looked dropped when it was merely 0.0. Asking
the type what it declares separates "no field for this" from "this field holds
a zero", which is the whole distinction the test is about.

This is the check that would have caught all four losses -- cycles, the species
suggestion, the crop share, the solar provenance -- at the time they happened.
It is deliberately allowed to fail on NEW sidecar keys: that failure is the
notification the previous arrangement had no way to send.
*/
func TestNoSidecarKeyIsSilentlyDropped(t *testing.T) {
	raw, err := os.ReadFile("testdata/canopy_from_aoi.json")
	if err != nil {
		t.Fatalf("reading fixture: %v", err)
	}
	var loose map[string]map[string]any
	if err := json.Unmarshal(raw, &loose); err != nil {
		t.Fatalf("decoding loosely: %v", err)
	}
	emitted := loose["canopy_from_aoi"]

	top := jsonTags(reflect.TypeOf(CanopyFromAOI{}))
	for key := range emitted {
		if _, ok := top[key]; !ok {
			t.Errorf("the sidecar emits %q and CanopyFromAOI declares no field "+
				"for it, so encoding/json discards it without any error", key)
		}
	}

	for _, group := range []string{"sun", "light"} {
		inner, ok := emitted[group].(map[string]any)
		if !ok {
			continue
		}
		declared, ok := top[group]
		if !ok {
			continue
		}
		fields := jsonTags(declared)
		for key := range inner {
			if _, ok := fields[key]; !ok {
				t.Errorf("%s.%s is emitted and has no field on %s", group, key,
					declared)
			}
		}
		// One level further, for the nested blocks that were themselves added
		// to carry things that used to be lost.
		for _, nested := range []string{"ensemble", "provenance"} {
			sub, ok := inner[nested].(map[string]any)
			if !ok {
				continue
			}
			subFields := jsonTags(fields[nested])
			for key := range sub {
				if _, ok := subFields[key]; !ok {
					t.Errorf("%s.%s.%s is emitted and has no field",
						group, nested, key)
				}
			}
		}
	}
}
