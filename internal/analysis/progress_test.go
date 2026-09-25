package analysis

import (
	"context"
	"testing"
)

// A context that names a sink receives the lines; one that names none sends
// them to the shared event, as every run from the band does.
func TestReportProgressFollowsTheContext(t *testing.T) {
	var shared []ProgressEvent
	prev := emitProgress
	emitProgress = func(_ context.Context, event string, data ...any) {
		if event != "predict:progress" {
			t.Errorf("event = %q", event)
		}
		shared = append(shared, data[0].(ProgressEvent))
	}
	t.Cleanup(func() { emitProgress = prev })

	var routed []ProgressEvent
	ctx := WithProgress(context.Background(), func(ev ProgressEvent) { routed = append(routed, ev) })
	reportProgress(ctx, ProgressEvent{Progress: 40, Msg: "reading scenes"})
	reportProgress(context.Background(), ProgressEvent{Progress: 10, Msg: "band run"})

	if len(routed) != 1 || routed[0].Msg != "reading scenes" {
		t.Fatalf("routed = %+v", routed)
	}
	if len(shared) != 1 || shared[0].Msg != "band run" {
		t.Fatalf("shared = %+v", shared)
	}
}
