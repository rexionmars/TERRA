package main

import (
	"context"
	"testing"
)

// A board with nothing unsaved closes without a dialog: beforeClose must not
// reach for the runtime at all, since a quit with nothing to lose is not a
// question worth asking.
func TestBeforeCloseLetsACleanBoardClose(t *testing.T) {
	a := NewApp()
	if a.beforeClose(context.Background()) {
		t.Fatal("a clean board was kept open")
	}
}

// The flag is the interface's report, held as it was last given.
func TestSetBoardDirtyIsWhatBeforeCloseReads(t *testing.T) {
	a := NewApp()
	a.SetBoardDirty(true)
	if !a.boardDirty.Load() {
		t.Fatal("dirty was not recorded")
	}
	a.SetBoardDirty(false)
	if a.beforeClose(context.Background()) {
		t.Fatal("a board saved again was kept open")
	}
}
