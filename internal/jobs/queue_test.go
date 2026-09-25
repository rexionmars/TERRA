package jobs

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// recorder keeps every list the queue announced.
type recorder struct {
	mu    sync.Mutex
	lists [][]Job
	lines []Job
}

func (r *recorder) notify(jobs []Job) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lists = append(r.lists, jobs)
}

func (r *recorder) progress(j Job) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lines = append(r.lines, j)
}

func (r *recorder) last() []Job {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.lists) == 0 {
		return nil
	}
	return r.lists[len(r.lists)-1]
}

func newQueue(t *testing.T) (*Queue, *recorder) {
	t.Helper()
	r := &recorder{}
	q := New(context.Background(), r.notify, r.progress)
	t.Cleanup(q.Close)
	return q, r
}

func wait(t *testing.T, q *Queue) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := q.Wait(ctx); err != nil {
		t.Fatalf("the queue did not drain: %v", err)
	}
}

func recorded(id string) Work {
	return func(context.Context, func(int, string)) (string, error) { return id, nil }
}

func states(jobs []Job) []State {
	out := make([]State, len(jobs))
	for i, j := range jobs {
		out[i] = j.State
	}
	return out
}

// Jobs run in the order they were added, one at a time, and each records the
// run its work returned.
func TestJobsRunInOrderOneAtATime(t *testing.T) {
	q, _ := newQueue(t)
	var mu sync.Mutex
	var order []string
	running := 0
	overlap := false
	work := func(name string) Work {
		return func(context.Context, func(int, string)) (string, error) {
			mu.Lock()
			running++
			if running > 1 {
				overlap = true
			}
			order = append(order, name)
			mu.Unlock()
			time.Sleep(5 * time.Millisecond)
			mu.Lock()
			running--
			mu.Unlock()
			return "run-" + name, nil
		}
	}
	for _, name := range []string{"a", "b", "c"} {
		if _, err := q.Add("classify", name, name, work(name)); err != nil {
			t.Fatal(err)
		}
	}
	wait(t, q)
	if overlap {
		t.Fatal("two jobs ran at once")
	}
	if got := len(order); got != 3 || order[0] != "a" || order[1] != "b" || order[2] != "c" {
		t.Fatalf("order = %v", order)
	}
	for _, j := range q.List() {
		if j.State != Done || j.RunID != "run-"+j.AreaID || j.Progress != 100 {
			t.Fatalf("job %+v did not finish as done with its run", j)
		}
		if j.StartedAt == "" || j.FinishedAt == "" {
			t.Fatalf("job %s has no start or finish time", j.ID)
		}
	}
}

// A failure is the job's alone: the error is kept on it and the next job runs.
// An analysis that records no run is a failure too.
func TestAFailedJobDoesNotStopTheQueue(t *testing.T) {
	q, _ := newQueue(t)
	_, _ = q.Add("classify", "a", "a", func(context.Context, func(int, string)) (string, error) {
		return "", errors.New("no scene under 20% cloud")
	})
	_, _ = q.Add("classify", "b", "b", func(context.Context, func(int, string)) (string, error) {
		return "", nil
	})
	_, _ = q.Add("classify", "c", "c", recorded("run-c"))
	wait(t, q)
	got := q.List()
	if s := states(got); s[0] != Failed || s[1] != Failed || s[2] != Done {
		t.Fatalf("states = %v", s)
	}
	if got[0].Error != "no scene under 20% cloud" {
		t.Fatalf("error = %q", got[0].Error)
	}
	if got[1].Error != ErrNotRecorded.Error() {
		t.Fatalf("an unrecorded run was not a failure: %q", got[1].Error)
	}
}

// A panic in one analysis fails that job and leaves the queue running.
func TestAPanickingJobFailsAlone(t *testing.T) {
	q, _ := newQueue(t)
	_, _ = q.Add("classify", "a", "a", func(context.Context, func(int, string)) (string, error) {
		panic("index out of range")
	})
	_, _ = q.Add("classify", "b", "b", recorded("run-b"))
	wait(t, q)
	if s := states(q.List()); s[0] != Failed || s[1] != Done {
		t.Fatalf("states = %v", s)
	}
}

// Cancelling a running job ends its context and marks it cancelled, not
// failed, whatever error the work returns on its way out; the queue moves on.
// A queued job that is cancelled never starts.
func TestCancelStopsTheRunningJobAndSkipsAQueuedOne(t *testing.T) {
	q, _ := newQueue(t)
	started := make(chan struct{})
	_, _ = q.Add("classify", "a", "a", func(ctx context.Context, _ func(int, string)) (string, error) {
		close(started)
		<-ctx.Done()
		return "", ctx.Err()
	})
	ranB := false
	b, _ := q.Add("classify", "b", "b", func(context.Context, func(int, string)) (string, error) {
		ranB = true
		return "run-b", nil
	})
	_, _ = q.Add("classify", "c", "c", recorded("run-c"))
	<-started
	if err := q.Cancel(b.ID); err != nil {
		t.Fatal(err)
	}
	if err := q.Cancel("job-1"); err != nil {
		t.Fatal(err)
	}
	wait(t, q)
	if ranB {
		t.Fatal("a cancelled queued job ran")
	}
	got := q.List()
	if s := states(got); s[0] != Cancelled || s[1] != Cancelled || s[2] != Done {
		t.Fatalf("states = %v", s)
	}
	if got[0].Error != "" {
		t.Fatalf("a cancelled job carries an error: %q", got[0].Error)
	}
	if q.Pending() != 0 {
		t.Fatalf("pending = %d after the queue drained", q.Pending())
	}
}

// Retrying puts the job at the end of the queue, clean, and runs it again.
// Only a failed or cancelled job can be retried.
func TestRetryRequeuesAtTheEnd(t *testing.T) {
	q, _ := newQueue(t)
	attempts := 0
	a, _ := q.Add("water", "a", "a", func(context.Context, func(int, string)) (string, error) {
		attempts++
		if attempts == 1 {
			return "", errors.New("timeout")
		}
		return "run-a", nil
	})
	b, _ := q.Add("water", "b", "b", recorded("run-b"))
	wait(t, q)
	if err := q.Retry(b.ID); err == nil {
		t.Fatal("a done job was retried")
	}
	if err := q.Retry(a.ID); err != nil {
		t.Fatal(err)
	}
	wait(t, q)
	got := q.List()
	if got[0].ID != b.ID || got[1].ID != a.ID {
		t.Fatalf("the retried job is not last: %v, %v", got[0].ID, got[1].ID)
	}
	if got[1].State != Done || got[1].Error != "" || got[1].RunID != "run-a" {
		t.Fatalf("retried job = %+v", got[1])
	}
}

// Clear removes what has finished and keeps what has not.
func TestClearKeepsUnfinishedJobs(t *testing.T) {
	q, _ := newQueue(t)
	release := make(chan struct{})
	_, _ = q.Add("classify", "a", "a", recorded("run-a"))
	wait(t, q)
	_, _ = q.Add("classify", "b", "b", func(context.Context, func(int, string)) (string, error) {
		<-release
		return "run-b", nil
	})
	_, _ = q.Add("classify", "c", "c", recorded("run-c"))
	q.Clear()
	got := q.List()
	if len(got) != 2 || got[0].AreaID != "b" || got[1].AreaID != "c" {
		t.Fatalf("after clear: %+v", got)
	}
	close(release)
	wait(t, q)
}

// Progress reaches the progress callback for the running job; a line with no
// percentage keeps the last one, and a percentage past 100 is held at 100.
func TestProgressIsReportedPerJob(t *testing.T) {
	q, r := newQueue(t)
	_, _ = q.Add("classify", "a", "a", func(_ context.Context, report func(int, string)) (string, error) {
		report(40, "reading scenes")
		report(-1, "a line with no percentage")
		report(140, "")
		return "run-a", nil
	})
	wait(t, q)
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.lines) != 3 {
		t.Fatalf("lines = %d", len(r.lines))
	}
	if r.lines[0].Progress != 40 || r.lines[0].Message != "reading scenes" {
		t.Fatalf("first line = %+v", r.lines[0])
	}
	if r.lines[1].Progress != 40 || r.lines[1].Message != "a line with no percentage" {
		t.Fatalf("second line = %+v", r.lines[1])
	}
	if r.lines[2].Progress != 100 {
		t.Fatalf("third line = %+v", r.lines[2])
	}
}

// Every change is announced, and the last list announced is the queue's state.
func TestTheLastAnnouncedListIsCurrent(t *testing.T) {
	q, r := newQueue(t)
	for _, id := range []string{"a", "b"} {
		_, _ = q.Add("classify", id, id, recorded("run-"+id))
	}
	wait(t, q)
	last := r.last()
	if s := states(last); len(s) != 2 || s[0] != Done || s[1] != Done {
		t.Fatalf("last announced = %v", s)
	}
}

// Closing cancels the running job and refuses new ones.
func TestCloseCancelsAndRefuses(t *testing.T) {
	r := &recorder{}
	q := New(context.Background(), r.notify, r.progress)
	started := make(chan struct{})
	_, _ = q.Add("classify", "a", "a", func(ctx context.Context, _ func(int, string)) (string, error) {
		close(started)
		<-ctx.Done()
		return "", ctx.Err()
	})
	_, _ = q.Add("classify", "b", "b", recorded("run-b"))
	<-started
	q.Close()
	wait(t, q)
	if s := states(q.List()); s[0] != Cancelled || s[1] != Cancelled {
		t.Fatalf("states = %v", s)
	}
	if _, err := q.Add("classify", "c", "c", recorded("run-c")); err == nil {
		t.Fatal("a closed queue accepted a job")
	}
}
